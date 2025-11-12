;; contracts/filing-manager.clar
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-DEADLINE-CLOSED u101)
(define-constant ERR-FILING-EXISTS u102)
(define-constant ERR-FILING-NOT-FOUND u103)
(define-constant ERR-INVALID-IPFS-HASH u104)
(define-constant ERR-INVALID-TAX-YEAR u105)
(define-constant ERR-INVALID-DEDUCTION-LIST u106)
(define-constant ERR-STATUS-TRANSITION u107)
(define-constant ERR-AUDIT-ALREADY-FLAGGED u108)
(define-constant ERR-UPDATE-NOT-ALLOWED u109)
(define-constant ERR-MAX-DEDUCTIONS u110)
(define-constant ERR-INVALID-STATUS u111)
(define-constant ERR-ADMIN-ONLY u112)
(define-constant ERR-CONTRACT-NOT-INITIALIZED u113)
(define-constant ERR-PAUSED u114)

(define-constant STATUS-SUBMITTED "submitted")
(define-constant STATUS-UNDER-AUDIT "under-audit")
(define-constant STATUS-APPROVED "approved")
(define-constant STATUS-DISPUTED "disputed")
(define-constant STATUS-REJECTED "rejected")

(define-constant MAX-DEDUCTIONS u20)
(define-constant IPFS-HASH-LENGTH u46)

(define-data-var contract-owner principal tx-sender)
(define-data-var next-filing-id uint u0)
(define-data-var is-paused bool false)
(define-data-var deadline-enforcer (optional principal) none)
(define-data-var audit-engine (optional principal) none)

(define-map filings uint
  {
    taxpayer: principal,
    tax-year: uint,
    ipfs-hash: (string-ascii 46),
    status: (string-ascii 20),
    submitted-at: uint,
    deduction-ids: (list 20 uint),
    audit-flags: uint
  }
)

(define-map filing-by-taxpayer-year {taxpayer: principal, tax-year: uint} uint)
(define-map status-history uint (list 10 {status: (string-ascii 20), block: uint, updater: principal}))

(define-read-only (get-filing (filing-id uint))
  (map-get? filings filing-id)
)

(define-read-only (get-filing-by-taxpayer-year (taxpayer principal) (tax-year uint))
  (map-get? filing-by-taxpayer-year {taxpayer: taxpayer, tax-year: tax-year})
)

(define-read-only (get-status-history (filing-id uint))
  (map-get? status-history filing-id)
)

(define-read-only (is-valid-status (status (string-ascii 20)))
  (or
    (is-eq status STATUS-SUBMITTED)
    (is-eq status STATUS-UNDER-AUDIT)
    (is-eq status STATUS-APPROVED)
    (is-eq status STATUS-DISPUTED)
    (is-eq status STATUS-REJECTED)
  )
)

(define-read-only (validate-ipfs-hash (hash (string-ascii 46)))
  (and
    (is-eq (len hash) IPFS-HASH-LENGTH)
    (is-eq (element-at hash u0) "Q")
    (is-eq (element-at hash u1) "m")
  )
)

(define-read-only (is-contract-owner)
  (is-eq tx-sender (var-get contract-owner))
)

(define-read-only (is-deadline-enforcer)
  (match (var-get deadline-enforcer)
    enforcer (is-eq tx-sender enforcer)
    false
  )
)

(define-read-only (is-audit-engine)
  (match (var-get audit-engine)
    engine (is-eq tx-sender engine)
    false
  )
)

(define-read-only (is-admin-or-owner)
  (or (is-contract-owner) (is-deadline-enforcer) (is-audit-engine))
)

(define-private (assert-not-paused)
  (asserts! (not (var-get is-paused)) (err ERR-PAUSED))
)

(define-private (assert-initialized)
  (asserts! (is-some (var-get deadline-enforcer)) (err ERR-CONTRACT-NOT-INITIALIZED))
  (asserts! (is-some (var-get audit-engine)) (err ERR-CONTRACT-NOT-INITIALIZED))
)

(define-private (record-status-change (filing-id uint) (new-status (string-ascii 20)))
  (let ((current (default-to (list) (map-get? status-history filing-id))))
    (map-set status-history filing-id
      (unwrap-panic (as-max-len? (append current {status: new-status, block: block-height, updater: tx-sender}) u10))
    )
  )
)

(define-public (initialize (deadline-principal principal) (audit-principal principal))
  (begin
    (asserts! (is-contract-owner) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-none (var-get deadline-enforcer)) (err ERR-CONTRACT-NOT-INITIALIZED))
    (var-set deadline-enforcer (some deadline-principal))
    (var-set audit-engine (some audit-principal))
    (ok true)
  )
)

(define-public (submit-tax-filing (tax-year uint) (ipfs-hash (string-ascii 46)) (deduction-ids (list 20 uint)))
  (let (
    (filing-id (var-get next-filing-id))
    (taxpayer tx-sender)
    (existing-id (get-filing-by-taxpayer-year taxpayer tax-year))
  )
    (assert-not-paused)
    (assert-initialized)
    (asserts! (> tax-year u2020) (err ERR-INVALID-TAX-YEAR))
    (asserts! (validate-ipfs-hash ipfs-hash) (err ERR-INVALID-IPFS-HASH))
    (asserts! (<= (len deduction-ids) MAX-DEDUCTIONS) (err ERR-MAX-DEDUCTIONS))
    (asserts! (is-none existing-id) (err ERR-FILING-EXISTS))
    (try! (contract-call? (unwrap! (var-get deadline-enforcer) (err ERR-CONTRACT-NOT-INITIALIZED)) is-open tax-year))
    (map-set filings filing-id
      {
        taxpayer: taxpayer,
        tax-year: tax-year,
        ipfs-hash: ipfs-hash,
        status: STATUS-SUBMITTED,
        submitted-at: block-height,
        deduction-ids: deduction-ids,
        audit-flags: u0
      }
    )
    (map-set filing-by-taxpayer-year {taxpayer: taxpayer, tax-year: tax-year} filing-id)
    (record-status-change filing-id STATUS-SUBMITTED)
    (var-set next-filing-id (+ filing-id u1))
    (try! (contract-call? (unwrap! (var-get audit-engine) (err ERR-CONTRACT-NOT-INITIALIZED)) notify-new-filing filing-id))
    (ok filing-id)
  )
)

(define-public (flag-for-audit (filing-id uint))
  (let ((filing (unwrap! (map-get? filings filing-id) (err ERR-FILING-NOT-FOUND))))
    (asserts! (is-audit-engine) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (is-eq (get status filing) STATUS-UNDER-AUDIT)) (err ERR-STATUS-TRANSITION))
    (map-set filings filing-id
      (merge filing {
        status: STATUS-UNDER-AUDIT,
        audit-flags: (+ (get audit-flags filing) u1)
      })
    )
    (record-status-change filing-id STATUS-UNDER-AUDIT)
    (ok true)
  )
)

(define-public (approve-filing (filing-id uint))
  (let ((filing (unwrap! (map-get? filings filing-id) (err ERR-FILING-NOT-FOUND))))
    (asserts! (or (is-audit-engine) (is-deadline-enforcer)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status filing) STATUS-UNDER-AUDIT) (err ERR-STATUS-TRANSITION))
    (map-set filings filing-id
      (merge filing {status: STATUS-APPROVED})
    )
    (record-status-change filing-id STATUS-APPROVED)
    (ok true)
  )
)

(define-public (reject-filing (filing-id uint))
  (let ((filing (unwrap! (map-get? filings filing-id) (err ERR-FILING-NOT-FOUND))))
    (asserts! (is-audit-engine) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status filing) STATUS-UNDER-AUDIT) (err ERR-STATUS-TRANSITION))
    (map-set filings filing-id
      (merge filing {status: STATUS-REJECTED})
    )
    (record-status-change filing-id STATUS-REJECTED)
    (ok true)
  )
)

(define-public (dispute-filing (filing-id uint))
  (let ((filing (unwrap! (map-get? filings filing-id) (err ERR-FILING-NOT-FOUND))))
    (asserts! (is-eq (get taxpayer filing) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (or
      (is-eq (get status filing) STATUS-UNDER-AUDIT)
      (is-eq (get status filing) STATUS-REJECTED)
    ) (err ERR-STATUS-TRANSITION))
    (map-set filings filing-id
      (merge filing {status: STATUS-DISPUTED})
    )
    (record-status-change filing-id STATUS-DISPUTED)
    (ok true)
  )
)

(define-public (resolve-dispute (filing-id uint) (final-status (string-ascii 20)))
  (let ((filing (unwrap! (map-get? filings filing-id) (err ERR-FILING-NOT-FOUND))))
    (asserts! (is-admin-or-owner) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status filing) STATUS-DISPUTED) (err ERR-STATUS-TRANSITION))
    (asserts! (is-valid-status final-status) (err ERR-INVALID-STATUS))
    (map-set filings filing-id
      (merge filing {status: final-status})
    )
    (record-status-change filing-id final-status)
    (ok true)
  )
)

(define-public (pause-contract)
  (begin
    (asserts! (is-contract-owner) (err ERR-NOT-AUTHORIZED))
    (var-set is-paused true)
    (ok true)
  )
)

(define-public (unpause-contract)
  (begin
    (asserts! (is-contract-owner) (err ERR-NOT-AUTHORIZED))
    (var-set is-paused false)
    (ok true)
  )
)

(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-contract-owner) (err ERR-NOT-AUTHORIZED))
    (var-set contract-owner new-owner)
    (ok true)
  )
)

(define-read-only (get-contract-status)
  (ok {
    owner: (var-get contract-owner),
    paused: (var-get is-paused),
    next-id: (var-get next-filing-id),
    deadline-enforcer: (var-get deadline-enforcer),
    audit-engine: (var-get audit-engine)
  })
)