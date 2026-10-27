import type { TrainingArticleSnapshot } from '../types'
import { useI18n } from '../i18n/context'
import { emptySummaryEvidence, METADATA_FIELDS, METADATA_STATUSES, readMetadataReview, readSummaryEvidence, sourceBlockText } from './evidence'

export function MetadataReviewForm({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const { t } = useI18n()
  const review = readMetadataReview(value)
  if (!review) return <p role="alert">{t('coach.structuredIncomplete')}</p>
  return <div className="structured-training-form metadata-review-form">
    <details className="metadata-review-editor">
      <summary>{t('coach.metadata.heading')}</summary>
      {METADATA_FIELDS.map((field) => <fieldset key={field} disabled={disabled}>
        <legend>{t(`coach.field.${field}`)}</legend>
        <label className="structured-field"><span>{t('coach.metadata.status')}</span><select value={review.fields[field].status} onChange={(event) => onChange(JSON.stringify({ ...review, reviewed: false, fields: { ...review.fields, [field]: { ...review.fields[field], status: event.target.value } } }))}>{METADATA_STATUSES.map((status) => <option key={status} value={status}>{t(`coach.metadata.${status}`)}</option>)}</select></label>
        {review.fields[field].status === 'found' && <label className="structured-field"><span>{t(`coach.field.${field}`)}</span><input value={review.fields[field].value} maxLength={240} onChange={(event) => onChange(JSON.stringify({ ...review, reviewed: false, fields: { ...review.fields, [field]: { ...review.fields[field], value: event.target.value } } }))} /></label>}
      </fieldset>)}
    </details>
    <section className="metadata-review-summary" aria-label={t('coach.metadata.heading')}>
      <div className="metadata-review-summary-header">
        <div>
          <span className="metadata-review-kicker">{t('coach.metadata.heading')}</span>
          <p>{t('coach.metadata.status')}</p>
        </div>
        <span className={`metadata-review-state${review.reviewed ? ' is-reviewed' : ''}`}>{review.reviewed ? t('coach.metadata.reviewed') : t('coach.metadata.pending')}</span>
      </div>
      <dl className="metadata-review-list">{METADATA_FIELDS.map((field) => {
        const item = review.fields[field]
        return <div className="metadata-review-row" key={field}>
          <dt>
            <span>{t(`coach.field.${field}`)}</span>
            <small className={`metadata-status metadata-status-${item.status}`}>{t(`coach.metadata.${item.status}`)}</small>
          </dt>
          <dd>{item.status === 'found' && item.value.trim() ? item.value : <span className="metadata-empty-value">{t(`coach.metadata.${item.status}`)}</span>}</dd>
        </div>
      })}</dl>
      <label className="metadata-review-confirm"><input type="checkbox" disabled={disabled} checked={review.reviewed} onChange={(event) => onChange(JSON.stringify({ ...review, reviewed: event.target.checked }))} /><span>{t('coach.metadata.reviewed')}</span></label>
    </section>
  </div>
}

export function SummaryEvidenceForm({ value, snapshot, disabled, onChange }: { value: string; snapshot: TrainingArticleSnapshot; disabled: boolean; onChange: (value: string) => void }) {
  const { t } = useI18n()
  const evidence = readSummaryEvidence(value) ?? emptySummaryEvidence(snapshot.id)
  const update = (index: number, patch: Partial<(typeof evidence.points)[number]>) => onChange(JSON.stringify({ ...evidence, checked: false, points: evidence.points.map((point, i) => i === index ? { ...point, ...patch } : point) }))
  return <div className="structured-training-form">
    {evidence.points.map((point, index) => {
      const block = snapshot.blocks.find((item) => item.id === point.blockId)
      return <fieldset key={index} disabled={disabled}>
        <legend>{t('coach.threePointLabel', { number: index + 1 })} · {t('coach.field.threePointSources')}</legend>
        <label className="structured-field"><span>{t('coach.applicability.source')}</span><select value={point.blockId} onChange={(event) => update(index, { blockId: event.target.value })}><option value="">—</option>{snapshot.blocks.filter((item) => item.id && sourceBlockText(item)).map((item, sourceIndex) => <option key={item.id} value={item.id}>{sourceIndex + 1}. {sourceBlockText(item).slice(0, 90)}</option>)}</select></label>
        {block && <details><summary>{t('coach.summary.locate')}</summary><p>{sourceBlockText(block)}</p></details>}
        <label className="structured-field"><span>{t('coach.applicability.quote')}</span><textarea maxLength={320} value={point.quote} onChange={(event) => update(index, { quote: event.target.value })} /></label>
        {point.quote && (!block || !sourceBlockText(block).includes(point.quote.trim())) && <p role="alert">{t('coach.summary.invalidQuote')}</p>}
      </fieldset>
    })}
    <label><input type="checkbox" checked={evidence.checked} disabled={disabled} onChange={(event) => onChange(JSON.stringify({ ...evidence, checked: event.target.checked }))} />{t('coach.summary.checked')}</label>
  </div>
}
