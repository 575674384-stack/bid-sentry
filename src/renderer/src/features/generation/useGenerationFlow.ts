import { useCallback, useEffect, useRef, useState } from 'react'
import {
  GenerationUserFormSchema,
  type AiSettings,
  type GenerationAnalysis,
  type GenerationPlan,
  type GenerationResult,
  type GenerationUserForm,
  type SelectedInputFile
} from '../../../../shared/contracts'
import { BidSentryApiError, bidSentryApi, userMessage } from '../../api/bidSentryApi'
import { onSettingsChanged } from '../settings/settingsEvents'

export const EMPTY_GENERATION_FORM: GenerationUserForm = {
  bidderName: '',
  unifiedSocialCreditCode: '',
  address: '',
  legalRepresentative: '',
  authorizedRepresentative: '',
  contact: '',
  phone: '',
  email: '',
  projectName: '',
  sectionName: '',
  compilationDate: '',
  extraFields: []
}

export type GenerationBusy = 'analyzing' | 'planning' | 'running' | null

export interface GenerationFlow {
  step: 1 | 2 | 3 | 4 | 5
  file: SelectedInputFile | null
  analysis: GenerationAnalysis | null
  candidateId: string
  form: GenerationUserForm
  formError: string | null
  plan: GenerationPlan | null
  planConfirmed: boolean
  result: GenerationResult | null
  busy: GenerationBusy
  error: string | null
  notice: string | null
  settings: AiSettings | null
  chooseFile(): Promise<void>
  analyze(): Promise<void>
  cancelBusy(): Promise<void>
  selectCandidate(candidateId: string): void
  goToStep(step: 1 | 2 | 3): void
  updateFormField(key: keyof GenerationUserForm, value: string): void
  updateExtraField(key: string, value: string): void
  createPlan(): Promise<void>
  setPlanConfirmed(confirmed: boolean): void
  run(): Promise<void>
  restart(): void
}

export function useGenerationFlow(): GenerationFlow {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [file, setFile] = useState<SelectedInputFile | null>(null)
  const [analysis, setAnalysis] = useState<GenerationAnalysis | null>(null)
  const [candidateId, setCandidateId] = useState('')
  const [form, setForm] = useState<GenerationUserForm>(EMPTY_GENERATION_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [plan, setPlan] = useState<GenerationPlan | null>(null)
  const [planConfirmed, setPlanConfirmed] = useState(false)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [busy, setBusy] = useState<GenerationBusy>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const requestSeq = useRef(0)

  useEffect(() => {
    let active = true
    bidSentryApi
      .getSettings()
      .then((value) => {
        if (active) setSettings(value)
      })
      .catch(() => {
        if (active) setSettings(null)
      })
    const unsubscribe = onSettingsChanged((value) => {
      if (active) setSettings(value)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  /** Drops plan/result whenever the plan inputs (candidate, form) change. */
  const invalidatePlan = useCallback(() => {
    setPlan(null)
    setPlanConfirmed(false)
    setResult(null)
  }, [])

  const chooseFile = useCallback(async (): Promise<void> => {
    setError(null)
    setNotice(null)
    try {
      const selected = await bidSentryApi.selectInputFiles()
      const candidate = selected.files[0]
      if (!candidate) return
      requestSeq.current += 1
      setFile(candidate)
      setAnalysis(null)
      setCandidateId('')
      setForm(EMPTY_GENERATION_FORM)
      setFormError(null)
      setPlan(null)
      setPlanConfirmed(false)
      setResult(null)
      setStep(1)
    } catch (reason) {
      setError(userMessage(reason))
    }
  }, [])

  const analyze = useCallback(async (): Promise<void> => {
    if (!file || busy) return
    const seq = ++requestSeq.current
    setBusy('analyzing')
    setError(null)
    setNotice(null)
    try {
      const value = await bidSentryApi.analyzeGeneration({
        schemaVersion: 1,
        inputId: file.inputId
      })
      if (seq !== requestSeq.current) return
      setAnalysis(value)
      setCandidateId('')
      setPlan(null)
      setPlanConfirmed(false)
      setResult(null)
      setForm(buildInitialForm(value, settings))
      setFormError(null)
      setStep(2)
    } catch (reason) {
      if (seq !== requestSeq.current) return
      if (isCancellation(reason)) {
        setNotice('分析已取消。')
      } else {
        setError(userMessage(reason))
      }
    } finally {
      if (seq === requestSeq.current) setBusy(null)
    }
  }, [file, busy, settings])

  const cancelBusy = useCallback(async (): Promise<void> => {
    if (!busy) return
    // The analysis task id is allocated in Main and only returned on success,
    // so abandoning an in-flight analysis is local-only; a running generation
    // is cancelled through the real task id.
    const taskId = analysis?.taskId
    requestSeq.current += 1
    setBusy(null)
    setNotice(busy === 'analyzing' ? '已取消分析。' : '已取消生成。')
    if (busy === 'running' && taskId) {
      try {
        await bidSentryApi.cancelGeneration(taskId)
      } catch {
        // Cancellation is best-effort; a finished task simply has nothing to cancel.
      }
    }
  }, [busy, analysis])

  const selectCandidate = useCallback(
    (nextCandidateId: string): void => {
      setCandidateId(nextCandidateId)
      invalidatePlan()
    },
    [invalidatePlan]
  )

  const goToStep = useCallback(
    (target: 1 | 2 | 3): void => {
      if (busy) return
      if (target === 2 && !analysis) return
      if (target === 3 && (!analysis || !candidateId)) return
      if (target === 3) invalidatePlan()
      if (target !== 3 && step > 3) invalidatePlan()
      setError(null)
      setStep(target)
    },
    [busy, analysis, candidateId, step, invalidatePlan]
  )

  const updateFormField = useCallback(
    (key: keyof GenerationUserForm, value: string): void => {
      setForm((current) => ({ ...current, [key]: value }))
      setFormError(null)
      invalidatePlan()
    },
    [invalidatePlan]
  )

  const updateExtraField = useCallback(
    (key: string, value: string): void => {
      setForm((current) => ({
        ...current,
        extraFields: current.extraFields.map((field) =>
          field.key === key ? { ...field, value } : field
        )
      }))
      setFormError(null)
      invalidatePlan()
    },
    [invalidatePlan]
  )

  const createPlan = useCallback(async (): Promise<void> => {
    if (!analysis || !candidateId || busy) return
    const parsed = GenerationUserFormSchema.safeParse(form)
    if (!parsed.success) {
      setFormError('请先填写投标单位名称等必填信息。')
      return
    }
    const seq = ++requestSeq.current
    setBusy('planning')
    setError(null)
    setNotice(null)
    setFormError(null)
    try {
      const value = await bidSentryApi.planGeneration({
        schemaVersion: 1,
        analysisTaskId: analysis.taskId,
        candidateId,
        userForm: parsed.data
      })
      if (seq !== requestSeq.current) return
      setPlan(value)
      setPlanConfirmed(false)
      setResult(null)
      setStep(4)
    } catch (reason) {
      if (seq !== requestSeq.current) return
      setError(userMessage(reason))
    } finally {
      if (seq === requestSeq.current) setBusy(null)
    }
  }, [analysis, candidateId, form, busy])

  const run = useCallback(async (): Promise<void> => {
    if (!file || !analysis || !plan || !planConfirmed || busy) return
    if (plan.unknownRequired > 0) return
    const seq = ++requestSeq.current
    setBusy('running')
    setError(null)
    setNotice(null)
    try {
      const value = await bidSentryApi.runGeneration({
        schemaVersion: 1,
        inputId: file.inputId,
        analysisTaskId: analysis.taskId,
        candidateId: plan.candidateId,
        planId: plan.planId,
        planDigest: plan.planDigest,
        confirmed: true
      })
      if (seq !== requestSeq.current) return
      setResult(value)
      setStep(5)
    } catch (reason) {
      if (seq !== requestSeq.current) return
      if (isCancellation(reason)) {
        setNotice('生成已取消，未发布任何文件。')
      } else {
        setError(userMessage(reason))
      }
    } finally {
      if (seq === requestSeq.current) setBusy(null)
    }
  }, [file, analysis, plan, planConfirmed, busy])

  const restart = useCallback((): void => {
    requestSeq.current += 1
    setFile(null)
    setAnalysis(null)
    setCandidateId('')
    setForm(EMPTY_GENERATION_FORM)
    setFormError(null)
    setPlan(null)
    setPlanConfirmed(false)
    setResult(null)
    setBusy(null)
    setError(null)
    setNotice(null)
    setStep(1)
  }, [])

  return {
    step,
    file,
    analysis,
    candidateId,
    form,
    formError,
    plan,
    planConfirmed,
    result,
    busy,
    error,
    notice,
    settings,
    chooseFile,
    analyze,
    cancelBusy,
    selectCandidate,
    goToStep,
    updateFormField,
    updateExtraField,
    createPlan,
    setPlanConfirmed,
    run,
    restart
  }
}

function buildInitialForm(
  analysis: GenerationAnalysis,
  settings: AiSettings | null
): GenerationUserForm {
  const profile = settings?.companyProfile
  return {
    ...EMPTY_GENERATION_FORM,
    ...(profile ?? {}),
    extraFields: analysis.extraction.suggestedFields.map((field) => ({
      key: field.key,
      label: field.label,
      value: ''
    }))
  }
}

function isCancellation(reason: unknown): boolean {
  return reason instanceof BidSentryApiError && reason.appError.code === 'TASK_CANCELLED'
}
