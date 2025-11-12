;; contracts/deadline-enforcer.clar
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-YEAR-EXISTS u101)
(define-constant ERR-YEAR-NOT-FOUND u102)
(define-constant ERR-INVALID-DATES u103)
(define-constant ERR-SEASON-CLOSED u104)
(define-constant ERR-SEASON-NOT-OPEN u105)
(define-constant ERR-INVALID-BLOCK-HEIGHT u106)
(define-constant ERR-CONTRACT-PAUSED u107)

(define-constant STATUS-OPEN "open")
(define-constant STATUS-CLOSED "closed")

(define-data-var contract-owner principal tx-sender)
(define-data-var is-paused bool false)

(define-map tax-seasons uint
  {
    start-block: uint,
    end-block: uint,
    status: (string-ascii 10),
    created-at: uint,
    updated-at: uint
  }
)

(define-map season-by-year uint uint)

(define-read-only (get-season (tax-year uint))
  (map-get? tax-seasons tax-year)
)

(define-read-only (is-open (tax-year uint))
  (match (map-get? tax-seasons tax-year)
    season
      (and
        (is-eq (get status season) STATUS-OPEN)
        (>= block-height (get start-block season))
        (<= block-height (get end-block season))
      )
    false
  )
)

(define-read-only (is-season-defined (tax-year uint))
  (is-some (map-get? tax-seasons tax-year))
)

(define-read-only (get-current-status)
  (ok {
    owner: (var-get contract-owner),
    paused: (var-get is-paused)
  })
)

(define-private (assert-not-paused)
  (asserts! (not (var-get is-paused)) (err ERR-CONTRACT-PAUSED))
)

(define-private (assert-owner)
  (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-NOT-AUTHORIZED))
)

(define-private (validate-block-range (start uint) (end uint))
  (and
    (> end start)
    (> start block-height)
    (<= (- end start) u525600)
  )
)

(define-public (define-season (tax-year uint) (start-block uint) (end-block uint))
  (let ((existing (map-get? tax-seasons tax-year)))
    (assert-not-paused)
    (assert-owner)
    (asserts! (is-none existing) (err ERR-YEAR-EXISTS))
    (asserts! (> tax-year u2020) (err ERR-INVALID-DATES))
    (asserts! (validate-block-range start-block end-block) (err ERR-INVALID-DATES))
    (map-set tax-seasons tax-year
      {
        start-block: start-block,
        end-block: end-block,
        status: STATUS-OPEN,
        created-at: block-height,
        updated-at: block-height
      }
    )
    (map-set season-by-year tax-year tax-year)
    (ok true)
  )
)

(define-public (open-season (tax-year uint))
  (let ((season (unwrap! (map-get? tax-seasons tax-year) (err ERR-YEAR-NOT-FOUND))))
    (assert-not-paused)
    (assert-owner)
    (asserts! (not (is-eq (get status season) STATUS-OPEN)) (err ERR-SEASON-NOT-OPEN))
    (map-set tax-seasons tax-year
      (merge season {
        status: STATUS-OPEN,
        updated-at: block-height
      })
    )
    (ok true)
  )
)

(define-public (close-season (tax-year uint))
  (let ((season (unwrap! (map-get? tax-seasons tax-year) (err ERR-YEAR-NOT-FOUND))))
    (assert-not-paused)
    (assert-owner)
    (asserts! (is-eq (get status season) STATUS-OPEN) (err ERR-SEASON-CLOSED))
    (map-set tax-seasons tax-year
      (merge season {
        status: STATUS-CLOSED,
        updated-at: block-height
      })
    )
    (ok true)
  )
)

(define-public (update-season-dates (tax-year uint) (new-start uint) (new-end uint))
  (let ((season (unwrap! (map-get? tax-seasons tax-year) (err ERR-YEAR-NOT-FOUND))))
    (assert-not-paused)
    (assert-owner)
    (asserts! (validate-block-range new-start new-end) (err ERR-INVALID-DATES))
    (map-set tax-seasons tax-year
      (merge season {
        start-block: new-start,
        end-block: new-end,
        updated-at: block-height
      })
    )
    (ok true)
  )
)

(define-public (pause-contract)
  (begin
    (assert-owner)
    (var-set is-paused true)
    (ok true)
  )
)

(define-public (unpause-contract)
  (begin
    (assert-owner)
    (var-set is-paused false)
    (ok true)
  )
)

(define-public (transfer-ownership (new-owner principal))
  (begin
    (assert-owner)
    (var-set contract-owner new-owner)
    (ok true)
  )
)

(define-read-only (get-all-seasons)
  (ok (map-get? tax-seasons))
)