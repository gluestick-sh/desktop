import { useTranslation } from 'react-i18next'
import {
  formatDoctorCheckLabel,
  formatDoctorDetail,
  formatDoctorHint,
} from './i18n/activityLog'
import ModalCloseButton from './ModalCloseButton'
import ModalOverlay from './ModalOverlay'
import './EnvironmentDialog.css'

export interface DoctorCheckItem {
  id: string
  ok: boolean
  detailKey?: string
  detail: string
  hintKey?: string
  hint?: string
  status: 'pending' | 'running' | 'done'
}

interface EnvironmentDialogProps {
  onClose: () => void
  doctorChecks: DoctorCheckItem[]
  doctorOK: boolean | null
  doctorLoading: boolean
  onRunDoctor: () => void
}

export default function EnvironmentDialog({
  onClose,
  doctorChecks,
  doctorOK,
  doctorLoading,
  onRunDoctor,
}: EnvironmentDialogProps) {
  const { t } = useTranslation()

  return (
    <ModalOverlay onClose={onClose} disabled={doctorLoading}>
      <div
        className="modal environment-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="environment-dialog-title"
        aria-modal="true"
      >
        <div className="modal-header">
          <h2 id="environment-dialog-title">{t('environment.title')}</h2>
          <ModalCloseButton
            disabled={doctorLoading}
            onClick={onClose}
            ariaLabel={t('app.close')}
          />
        </div>

        <div className="modal-body">
          <div className="environment-panel environment-panel-diagnosis">
            <p className="environment-panel-intro">{t('environment.diagnosisIntro')}</p>
            {doctorChecks.length > 0 && (
              <ul className="doctor-check-list">
                {doctorChecks.map((check) => (
                  <li
                    key={check.id}
                    className={
                      check.status === 'pending'
                        ? 'doctor-check-pending'
                        : check.status === 'running'
                          ? 'doctor-check-running'
                          : check.ok
                            ? 'doctor-check-ok'
                            : 'doctor-check-fail'
                    }
                  >
                    <div className="doctor-check-head">
                      <span className="doctor-check-mark">
                        {check.status === 'pending'
                          ? '○'
                          : check.status === 'running'
                            ? '…'
                            : check.ok
                              ? '✓'
                              : '✗'}
                      </span>
                      <strong>{formatDoctorCheckLabel(check.id, t)}</strong>
                      <span className="doctor-check-detail">{formatDoctorDetail(check, t)}</span>
                    </div>
                    {check.status === 'done' && !check.ok && (check.hint || check.hintKey) && (
                      <p className="doctor-check-hint">→ {formatDoctorHint(check, t)}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {doctorLoading && doctorOK === null && (
              <p className="doctor-running-hint">{t('doctor.running')}</p>
            )}
            {!doctorLoading && doctorOK !== null && (
              <p className={`doctor-summary ${doctorOK ? 'is-ok' : 'is-warn'}`}>
                {doctorOK ? t('doctor.summaryOk') : t('doctor.summaryFail')}
              </p>
            )}
          </div>
        </div>

        <div className="modal-footer environment-footer">
          <button type="button" className="secondary" disabled={doctorLoading} onClick={onRunDoctor}>
            {t('environment.rerunDiagnosis')}
          </button>
          <button type="button" className="primary" disabled={doctorLoading} onClick={onClose}>
            {t('app.close')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
