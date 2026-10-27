import type { TrainingFieldAssist, TrainingFieldAssistMode } from '../types'
import { useI18n } from '../i18n/context'

export function FieldAssist({ fieldId, assist, aiConfigured, busyKey, disabled, onRequest }: {
  fieldId: string
  assist?: TrainingFieldAssist
  aiConfigured: boolean
  busyKey: string | null
  disabled: boolean
  onRequest: (fieldId: string, mode: TrainingFieldAssistMode) => void
}) {
  const { t } = useI18n()
  const hintBusy = busyKey === `${fieldId}:hint`
  const referenceBusy = busyKey === `${fieldId}:reference`
  return <div className="field-assist">
    <div className="field-assist-actions">
      <button className="text-button" type="button" disabled={disabled || !aiConfigured || Boolean(busyKey)} onClick={() => onRequest(fieldId, 'hint')}>
        {hintBusy ? t('coach.fieldAssist.loading') : t('coach.fieldAssist.hint')}
      </button>
      <button className="text-button" type="button" disabled={disabled || !aiConfigured || Boolean(busyKey)} onClick={() => onRequest(fieldId, 'reference')}>
        {referenceBusy ? t('coach.fieldAssist.loading') : t('coach.fieldAssist.reference')}
      </button>
    </div>
    {assist && <div className="field-assist-result">
      <strong>{assist.mode === 'hint' ? t('coach.fieldAssist.hintResult') : t('coach.fieldAssist.referenceResult')}</strong>
      <p>{assist.answer}</p>
      <details>
        <summary>{t('coach.fieldAssist.sources')}</summary>
        {assist.sources.map((source, index) => <p key={`${source.blockId ?? source.paragraph}-${index}`}><strong>{source.blockId ? t('feedback.sourceBlock', { id: source.blockId }) : t('feedback.paragraph', { number: source.paragraph })}</strong> <q>{source.quote}</q> {source.comment}</p>)}
      </details>
    </div>}
  </div>
}
