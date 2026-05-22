import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getPatterns } from '../utils/getPatterns'
import { supabase } from '../api/supabase'

const EXAM_MODEL = 'claude-sonnet-4-6'
const EXAM_PROMPT_VERSION = 'exam_simulator_v1'
const EXAM_MARKING_MODEL = 'claude-sonnet-4-6'
const EXAM_MARKING_PROMPT_VERSION = 'exam_answer_only_marking_v1'
const EXAM_GENERATION_MONTHLY_LIMIT = 3
const EXAM_MARKING_MONTHLY_LIMIT = 3
const EXAM_SIMULATION_STORAGE_LIMIT = 5

function buildSimulationPrompt(data) {
  const examPapers = data.papers.filter(p => p.assessment_type === 'Past Exam')
  const topTopics = data.topicFrequency.slice(0, 10)
  const favourites = data.topicFrequency
    .flatMap(t => t.subtypes.filter(s => s.isFavourite)
      .map(s => `${t.topic} - ${s.sub_type} (${s.paperCount}/${examPapers.length} papers)`))
  const positions = data.positionPatterns
    .map(p => `${p.position}: ${p.topics.slice(0, 2).map(t => t.topic).join(' / ')}`)

  const paperWithInstructions = examPapers
    .filter(p => p.instructions && p.instructions.length > 0)
    .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())[0]
  const realInstructions = paperWithInstructions?.instructions || []

  const calculatorsAllowed = examPapers.some(p => p.calculators_allowed === true)
    ? true
    : examPapers.some(p => p.calculators_allowed === false)
    ? false
    : null

  const timeMinutes = examPapers
    .map(p => p.time_minutes)
    .filter(Boolean)
    .sort()[0] || 180

  const attemptQ = examPapers
    .map(p => p.attempt_questions)
    .filter(Boolean)
    .sort()[0] || Math.min(data.positionPatterns.length, 7)

  const hasMarks = data.markPatterns.length > 0
  const avgMarksPerQ = hasMarks
    ? Math.round(data.markPatterns.reduce((s, m) => s + m.totalMarks, 0) / data.positionPatterns.length)
    : 25

  return `You are Atlas, an expert math exam simulator. Generate ONE complete simulated exam paper based on these detected patterns from ${examPapers.length} past papers.

DETECTED PAPER STRUCTURE:
- Papers analysed: ${examPapers.map(p => p.name).join(', ')}
- Typical questions per paper: ${data.positionPatterns.length}
- Marks per question: approximately ${avgMarksPerQ}
- Question position patterns: ${positions.join(' | ')}

TOPIC FREQUENCY:
${topTopics.map(t => `- ${t.topic}: ${t.count} questions across ${t.paperCount}/${examPapers.length} papers`).join('\n')}

EXAMINER FAVOURITES:
${favourites.slice(0, 12).join('\n') || 'Insufficient data'}

${hasMarks ? `MARK ALLOCATION PATTERNS:\n${data.markPatterns.slice(0, 8).map(m => `- ${m.topic}: avg ${m.avgMarks} marks per question`).join('\n')}` : ''}

INSTRUCTIONS FOR GENERATION:
1. Generate exactly ${attemptQ} questions following the detected position patterns
2. Each question must have exactly 3 lettered parts: (a), (b), (c)
3. Each part may have sub-parts (i), (ii) where needed - keep sub-parts minimal, 1-2 per part maximum
4. Assign realistic mark allocations matching the patterns - each question should total approximately ${avgMarksPerQ} marks
5. Follow the topic order detected in position patterns
6. Use the examiner favourite sub-types as the specific question content
7. Write questions at the appropriate difficulty for the course level detected
8. Include realistic mathematical notation and specific values/functions

Respond with ONLY a valid JSON object in exactly this format - no preamble, no explanation:
{
  "title": "Simulated Exam Paper",
  "subtitle": "Based on ${examPapers.length} past paper${examPapers.length !== 1 ? 's' : ''} - For practice only",
  "instructions": ${realInstructions.length > 0 ? JSON.stringify(realInstructions) : '["Attempt all questions", "Show all working clearly", "' + (calculatorsAllowed === false ? 'Calculators are NOT allowed' : calculatorsAllowed === true ? 'Calculators are permitted' : 'Check your paper for calculator policy') + '"]'},
  "timeMinutes": ${timeMinutes},
  "totalMarks": number,
  "questions": [
    {
      "number": "1",
      "parts": [
        {
          "label": "a",
          "text": "full question text",
          "marks": number,
          "subparts": [
            { "label": "i", "text": "sub-question text", "marks": number }
          ]
        }
      ],
      "totalMarks": number
    }
  ]
}`
}

function buildMarkingPrompt({ exam, answers }) {
  const questions = exam?.questions || []
  const payload = {
    exam: {
      title: exam?.title || 'Simulated Exam Paper',
      totalMarks: exam?.totalMarks || null,
      timeMinutes: exam?.timeMinutes || null
    },
    questions: questions.map(function (question, index) {
      const answer = answers[index] || {}
      return {
        question_index: index,
        question_number: String(question.number || index + 1),
        marks_available: question.totalMarks || null,
        question: question,
        student_answer: answer.answer_text || ''
      }
    })
  }

  return `You are Atlas, marking a submitted math exam attempt using answer-only evidence.

IMPORTANT MARKING RULES:
- This is V1 answer-only marking. Do not assume unstated working.
- Award marks for final answers, key facts, and graph/sketch features the student typed.
- If a question requires a drawing, mark typed key features such as intercepts, turning points, asymptotes, domain, and range.
- Infer the expected answer from the question text and mark allocation.
- If the answer is blank, award 0 and use error_type "incomplete_answer".
- If the response cannot be marked fairly from typed evidence, use correctness "not_markable" and error_type "not_markable".
- Be conservative. This is an estimated mark, not an official grade.

Return ONLY valid JSON in this exact shape:
{
  "summary": {
    "marks_awarded": number,
    "marks_available": number,
    "estimated_percentage": number,
    "overall_feedback": "brief performance diagnosis",
    "top_weaknesses": ["weakness"],
    "recommended_mastery_topics": ["topic"]
  },
  "results": [
    {
      "question_index": number,
      "question_number": "1",
      "topic": "topic or null",
      "sub_topic": "sub-topic or null",
      "marks_awarded": number,
      "marks_available": number,
      "correctness": "correct|partially_correct|incorrect|not_markable",
      "error_type": "none|concept_gap|method_gap|algebra_error|notation_error|incomplete_answer|misread_question|time_pressure|exam_technique|not_markable",
      "confidence": number,
      "feedback_summary": "short explanation",
      "lost_mark_reasons": ["reason"],
      "recommended_mastery_topics": ["topic"]
    }
  ]
}

Submitted attempt:
${JSON.stringify(payload)}`
}

function renderQuestionText(text) {
  if (!text) return ''

  const lines = text.split('\n')
  const segments = []
  let tableLines = []
  let textLines = []

  function flushText() {
    if (textLines.length > 0) {
      segments.push({ type: 'text', content: textLines.join('\n') })
      textLines = []
    }
  }

  function flushTable() {
    if (tableLines.length > 0) {
      segments.push({ type: 'table', content: tableLines.join('\n') })
      tableLines = []
    }
  }

  function isTableLine(line) {
    const trimmed = line.trim()
    const pipes = (trimmed.match(/\|/g) || []).length
    return trimmed.startsWith('|') && trimmed.endsWith('|') && pipes >= 3
  }

  for (const line of lines) {
    if (isTableLine(line)) {
      flushText()
      tableLines.push(line)
    } else {
      flushTable()
      textLines.push(line)
    }
  }
  flushText()
  flushTable()

  return segments.map(function (seg) {
    if (seg.type === 'table') return renderTable(seg.content)
    const inlineTablePattern = /(\|(?:[^|\n]+\|){2,})/g
    if (inlineTablePattern.test(seg.content)) {
      return seg.content.replace(
        /(\|(?:[^|\n]+\|){2,}(?:\s*\|(?:[^|\n]+\|){2,})*)/g,
        function (match) { return renderTable(match) }
      )
    }
    return seg.content
  }).join('')
}

function renderTable(tableText) {
  const rows = tableText.trim().split('\n').filter(r => r.trim())
  const isSeparator = r => /^\|[\s\-:|]+\|$/.test(r.trim())
  const parseRow = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
  const allRows = rows.length === 1
    ? tableText.trim().split(/\|\s*\|/).map(r => '|' + r + '|').filter(r => r.trim() !== '||')
    : rows

  let html = '<table style="border-collapse:collapse;margin:0.5rem 0;font-size:0.85rem">'
  let isHeader = true
  for (const row of allRows) {
    if (!row.trim()) continue
    if (isSeparator(row)) { isHeader = false; continue }
    const cells = parseRow(row)
    if (cells.length < 2) continue
    const tag = isHeader ? 'th' : 'td'
    const style = isHeader
      ? 'border:1px solid var(--border);padding:0.3rem 0.6rem;text-align:center;background:var(--bg-subtle)'
      : 'border:1px solid var(--border);padding:0.3rem 0.6rem;text-align:center'
    html += '<tr>' + cells.map(c => `<${tag} style="${style}">${c}</${tag}>`).join('') + '</tr>'
    isHeader = false
  }
  html += '</table>'
  return html
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds]
    .map(n => String(n).padStart(2, '0'))
    .join(':')
}

function getQuestionLabel(question, index) {
  return 'Q' + (question?.number || index + 1)
}

function formatMarkValue(value) {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  if (Number.isNaN(number)) return String(value)
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  if (Number.isNaN(number)) return '-'
  return Math.round(number) + '%'
}

function getResultTone(correctness) {
  if (correctness === 'correct') return 'Correct'
  if (correctness === 'partially_correct') return 'Partial'
  if (correctness === 'incorrect') return 'Incorrect'
  return 'Not markable'
}

function getMonthStartIso() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

export default function SimulatePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { simulationId } = useParams()

  const [patterns, setPatterns] = useState(null)
  const [exam, setExam] = useState(null)
  const [simulation, setSimulation] = useState(null)
  const [answers, setAnswers] = useState({})
  const [markingResults, setMarkingResults] = useState({})
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false)
  const [error, setError] = useState('')
  const saveTimersRef = useRef({})

  useEffect(function () {
    if (!user) return
    if (simulationId) loadSimulation(simulationId)
    else loadPatterns()
  }, [user, simulationId])

  useEffect(function () {
    if (simulation?.status !== 'in_progress') return
    const timer = window.setInterval(function () {
      setNow(Date.now())
    }, 1000)
    return function () { window.clearInterval(timer) }
  }, [simulation?.status])

  async function loadSimulation(id) {
    setLoading(true)
    setError('')
    try {
      const { data, error } = await supabase
        .from('exam_simulations')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (error) throw error

      setSimulation(data)
      setPatterns(data.patterns_snapshot || null)
      setExam(data.exam_json || null)
      setCurrentQuestionIndex(data.current_question_index || 0)

      const { data: answerRows, error: answersError } = await supabase
        .from('exam_simulation_answers')
        .select('*')
        .eq('simulation_id', id)
        .eq('user_id', user.id)

      if (answersError) throw answersError

      const answerMap = {}
      for (const row of answerRows || []) {
        answerMap[row.question_index] = {
          answer_text: row.answer_text || '',
          flagged: row.flagged || false
        }
      }
      setAnswers(answerMap)

      const { data: markingRows, error: markingError } = await supabase
        .from('exam_simulation_marking_results')
        .select('*')
        .eq('simulation_id', id)
        .eq('user_id', user.id)

      if (markingError) throw markingError

      const resultMap = {}
      for (const row of markingRows || []) {
        resultMap[row.question_index] = row
      }
      setMarkingResults(resultMap)

      if (data.status === 'failed') {
        setError(data.error || 'Simulation generation failed.')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadPatterns() {
    setLoading(true)
    setError('')
    try {
      const data = await getPatterns(user.id)
      if (data.confidence < 70) {
        navigate('/patterns')
        return
      }
      setPatterns(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function generateExam() {
    if (!patterns) return
    setGenerating(true)
    setError('')

    let simulationRecord = null

    try {
      await assertGenerationQuota()
      const { data: created, error: createError } = await supabase
        .from('exam_simulations')
        .insert({
          user_id: user.id,
          status: 'generating',
          source: 'pattern_generated',
          confidence_at_creation: patterns.confidence,
          patterns_snapshot: patterns,
          model: EXAM_MODEL,
          prompt_version: EXAM_PROMPT_VERSION
        })
        .select()
        .single()

      if (createError) throw createError
      simulationRecord = created
      setSimulation(created)

      const prompt = buildSimulationPrompt(patterns)
      const { data: { session } } = await supabase.auth.getSession()

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/atlas-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          },
          body: JSON.stringify({
            systemPrompt: 'You are Atlas, an expert math exam generator. You generate realistic exam papers in valid JSON format only. Never include text outside the JSON object.',
            messages: [{ role: 'user', content: prompt }],
            context: 'exam_simulation',
            maxTokens: 8192
          })
        }
      )

      const result = await response.json()
      if (result.error) throw new Error(result.error)

      const raw = result.text.replace(/```json|```/g, '').trim()
      const examData = JSON.parse(raw)

      const { data: updated, error: updateError } = await supabase
        .from('exam_simulations')
        .update({
          status: 'generated',
          exam_json: examData,
          error: null
        })
        .eq('id', simulationRecord.id)
        .eq('user_id', user.id)
        .select()
        .single()

      if (updateError) throw updateError
      setSimulation(updated)
      setExam(examData)
      navigate('/simulate/' + simulationRecord.id, { replace: true })
    } catch (e) {
      if (simulationRecord?.id) {
        await supabase
          .from('exam_simulations')
          .update({
            status: 'failed',
            error: e.message
          })
          .eq('id', simulationRecord.id)
          .eq('user_id', user.id)
      }
      setError('Failed to generate exam: ' + e.message)
    } finally {
      setGenerating(false)
    }
  }

  async function assertGenerationQuota() {
    const monthStart = getMonthStartIso()
    const activeStatuses = ['generated', 'in_progress', 'submitted', 'marking', 'marked', 'marking_failed']

    const { count: storedCount, error: storedError } = await supabase
      .from('exam_simulations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', activeStatuses)

    if (storedError) throw storedError
    if ((storedCount || 0) >= EXAM_SIMULATION_STORAGE_LIMIT) {
      throw new Error(`You have reached the ${EXAM_SIMULATION_STORAGE_LIMIT}-paper simulator storage limit. Review an existing paper before generating another.`)
    }

    const { count: monthlyCount, error: monthlyError } = await supabase
      .from('exam_simulations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', monthStart)
      .neq('status', 'failed')

    if (monthlyError) throw monthlyError
    if ((monthlyCount || 0) >= EXAM_GENERATION_MONTHLY_LIMIT) {
      throw new Error(`You have reached this month's limit of ${EXAM_GENERATION_MONTHLY_LIMIT} generated papers.`)
    }
  }

  async function hasMarkingQuota() {
    const monthStart = getMonthStartIso()
    const { count, error } = await supabase
      .from('exam_simulations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('submitted_at', monthStart)
      .in('status', ['marking', 'marked', 'marking_failed'])

    if (error) throw error
    return (count || 0) < EXAM_MARKING_MONTHLY_LIMIT
  }

  async function startExam() {
    if (!simulation || !exam) return
    setSaving(true)
    setError('')
    try {
      const { data, error } = await supabase
        .from('exam_simulations')
        .update({
          status: 'in_progress',
          started_at: simulation.started_at || new Date().toISOString(),
          current_question_index: 0
        })
        .eq('id', simulation.id)
        .eq('user_id', user.id)
        .select()
        .single()

      if (error) throw error
      setSimulation(data)
      setCurrentQuestionIndex(0)
      setNow(Date.now())
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveAnswerRecord(index, answerState) {
    if (!simulation || !user || ['submitted', 'marking', 'marked', 'marking_failed'].includes(simulation.status)) return
    const questions = exam?.questions || []
    const question = questions[index]
    setSaving(true)
    try {
      const { error } = await supabase
        .from('exam_simulation_answers')
        .upsert({
          simulation_id: simulation.id,
          user_id: user.id,
          question_index: index,
          question_number: question?.number ? String(question.number) : String(index + 1),
          answer_text: answerState?.answer_text || '',
          flagged: answerState?.flagged || false
        }, { onConflict: 'simulation_id,question_index' })

      if (error) throw error
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function updateAnswer(index, value) {
    const next = {
      ...(answers[index] || { flagged: false }),
      answer_text: value
    }
    setAnswers(prev => ({ ...prev, [index]: next }))
    scheduleSave(index, next)
  }

  function scheduleSave(index, answerState) {
    window.clearTimeout(saveTimersRef.current[index])
    saveTimersRef.current[index] = window.setTimeout(function () {
      saveAnswerRecord(index, answerState)
    }, 800)
  }

  function flushAnswer(index) {
    window.clearTimeout(saveTimersRef.current[index])
    return saveAnswerRecord(index, answers[index] || { answer_text: '', flagged: false })
  }

  async function toggleFlag(index) {
    const next = {
      ...(answers[index] || { answer_text: '' }),
      flagged: !(answers[index]?.flagged)
    }
    setAnswers(prev => ({ ...prev, [index]: next }))
    await saveAnswerRecord(index, next)
  }

  async function goToQuestion(index) {
    const questions = exam?.questions || []
    if (index < 0 || index >= questions.length) return
    await flushAnswer(currentQuestionIndex)
    setCurrentQuestionIndex(index)
    await supabase
      .from('exam_simulations')
      .update({ current_question_index: index })
      .eq('id', simulation.id)
      .eq('user_id', user.id)
  }

  function getSubmitCounts() {
    const questions = exam?.questions || []
    const unanswered = questions.filter(function (_question, index) {
      return !(answers[index]?.answer_text || '').trim()
    }).length
    const flagged = Object.values(answers).filter(answer => answer.flagged).length
    return { unanswered, flagged }
  }

  function requestSubmitExam() {
    if (!simulation || !exam) return
    setSubmitDialogOpen(true)
  }

  async function confirmSubmitExam() {
    if (!simulation || !exam) return
    setSubmitting(true)
    setError('')
    try {
      setSubmitDialogOpen(false)
      await flushAnswer(currentQuestionIndex)
      const canMark = await hasMarkingQuota()
      const { data, error } = await supabase
        .from('exam_simulations')
        .update({
          status: canMark ? 'marking' : 'marking_failed',
          submitted_at: simulation.submitted_at || new Date().toISOString(),
          marking_model: EXAM_MARKING_MODEL,
          marking_prompt_version: EXAM_MARKING_PROMPT_VERSION,
          marking_error: canMark ? null : `Monthly marking limit reached. This attempt is saved, but Atlas will not mark it this month.`
        })
        .eq('id', simulation.id)
        .eq('user_id', user.id)
        .select()
        .single()

      if (error) throw error
      setSimulation(data)
      if (canMark) {
        await markSubmittedExam(data)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function retryMarking() {
    if (!simulation || !exam || simulation.status !== 'marking_failed') return
    setSubmitting(true)
    setError('')
    try {
      const canMark = await hasMarkingQuota()
      if (!canMark) {
        throw new Error(`Monthly marking limit reached. You can review this attempt, but Atlas cannot mark more papers this month.`)
      }
      const { data, error } = await supabase
        .from('exam_simulations')
        .update({
          status: 'marking',
          marking_model: EXAM_MARKING_MODEL,
          marking_prompt_version: EXAM_MARKING_PROMPT_VERSION,
          marking_error: null
        })
        .eq('id', simulation.id)
        .eq('user_id', user.id)
        .select()
        .single()

      if (error) throw error
      setSimulation(data)
      await markSubmittedExam(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function markSubmittedExam(markingSimulation) {
    try {
      const prompt = buildMarkingPrompt({ exam, answers })
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/atlas-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          },
          body: JSON.stringify({
            systemPrompt: 'You are Atlas, an expert math examiner. Mark submitted answer-only exam attempts conservatively and return valid JSON only.',
            messages: [{ role: 'user', content: prompt }],
            context: 'exam_marking',
            sessionId: markingSimulation.id,
            userId: user.id,
            maxTokens: 8192
          })
        }
      )

      const result = await response.json()
      if (!response.ok || result.error) throw new Error(result.error || 'Marking request failed')

      const raw = result.text.replace(/```json|```/g, '').trim()
      const marking = JSON.parse(raw)
      const rows = (marking.results || []).map(function (item) {
        return {
          simulation_id: markingSimulation.id,
          user_id: user.id,
          question_index: item.question_index,
          question_number: item.question_number ? String(item.question_number) : String(item.question_index + 1),
          topic: item.topic || null,
          sub_topic: item.sub_topic || null,
          marks_awarded: item.marks_awarded ?? null,
          marks_available: item.marks_available ?? null,
          correctness: item.correctness || 'not_markable',
          error_type: item.error_type || 'not_markable',
          confidence: item.confidence ?? null,
          feedback_summary: item.feedback_summary || null,
          lost_mark_reasons: item.lost_mark_reasons || [],
          recommended_mastery_topics: item.recommended_mastery_topics || [],
          raw_result: item
        }
      })

      if (rows.length > 0) {
        const { error: resultsError } = await supabase
          .from('exam_simulation_marking_results')
          .upsert(rows, { onConflict: 'simulation_id,question_index' })

        if (resultsError) throw resultsError

        const resultMap = {}
        for (const row of rows) {
          resultMap[row.question_index] = row
        }
        setMarkingResults(resultMap)
      }

      const { data: marked, error: markedError } = await supabase
        .from('exam_simulations')
        .update({
          status: 'marked',
          marked_at: new Date().toISOString(),
          marking_summary: marking.summary || {},
          marking_error: null
        })
        .eq('id', markingSimulation.id)
        .eq('user_id', user.id)
        .select()
        .single()

      if (markedError) throw markedError
      setSimulation(marked)
    } catch (e) {
      const { data } = await supabase
        .from('exam_simulations')
        .update({
          status: 'marking_failed',
          marking_error: e.message
        })
        .eq('id', markingSimulation.id)
        .eq('user_id', user.id)
        .select()
        .single()

      if (data) setSimulation(data)
      throw e
    }
  }

  function getRemainingMs() {
    if (!simulation?.started_at || !exam?.timeMinutes) return 0
    const end = new Date(simulation.started_at).getTime() + exam.timeMinutes * 60 * 1000
    return Math.max(0, end - now)
  }

  function getAnsweredCount() {
    return (exam?.questions || []).filter(function (_question, index) {
      return (answers[index]?.answer_text || '').trim().length > 0
    }).length
  }

  function renderQuestion(question) {
    return (
      <div>
        <div className="row" style={{ marginBottom: '0.75rem', alignItems: 'baseline' }}>
          <h2 style={{ marginBottom: 0 }}>Question {question.number}</h2>
          <span className="spacer" />
          {question.totalMarks && (
            <span className="muted" style={{ fontSize: '0.85rem' }}>[{question.totalMarks} marks]</span>
          )}
        </div>
        {(question.parts || []).map(function (part, pi) {
          return (
            <div key={pi} style={{ marginBottom: '1rem' }}>
              <p style={{ fontSize: '0.95rem', marginBottom: '0.35rem' }}>
                <strong>({part.label})</strong>{' '}
                <span dangerouslySetInnerHTML={{ __html: renderQuestionText(part.text) }} />
                {part.marks && !part.subparts?.length && (
                  <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.8rem' }}>[{part.marks}]</span>
                )}
              </p>
              {(part.subparts || []).map(function (sub, si) {
                return (
                  <p key={si} style={{ fontSize: '0.9rem', paddingLeft: '1rem', marginBottom: '0.35rem' }}>
                    <strong>{sub.label}.</strong>{' '}
                    <span dangerouslySetInnerHTML={{ __html: renderQuestionText(sub.text) }} />
                    {sub.marks && (
                      <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.8rem' }}>[{sub.marks}]</span>
                    )}
                  </p>
                )
              })}
            </div>
          )
        })}
      </div>
    )
  }

  function renderReportSummary() {
    const summary = simulation?.marking_summary || {}
    const awarded = summary.marks_awarded
    const available = summary.marks_available || exam?.totalMarks
    const percentage = summary.estimated_percentage
      ?? (awarded !== undefined && available ? Number(awarded) / Number(available) * 100 : null)
    const weaknesses = Array.isArray(summary.top_weaknesses) ? summary.top_weaknesses : []
    const recommendedTopics = Array.isArray(summary.recommended_mastery_topics) ? summary.recommended_mastery_topics : []

    return (
      <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '1.5rem' }}>
        <p style={{ fontWeight: 'bold', marginBottom: '0.85rem' }}>Post-exam report</p>
        <div className="row" style={{ gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div>
            <p style={{ fontSize: '1.4rem', lineHeight: 1 }}>{formatPercent(percentage)}</p>
            <p className="muted" style={{ fontSize: '0.8rem' }}>Estimated score</p>
          </div>
          <div>
            <p style={{ fontSize: '1.4rem', lineHeight: 1 }}>
              {formatMarkValue(awarded)} / {formatMarkValue(available)}
            </p>
            <p className="muted" style={{ fontSize: '0.8rem' }}>Estimated marks</p>
          </div>
        </div>

        {summary.overall_feedback && (
          <p className="muted" style={{ fontSize: '0.9rem', marginBottom: '0.85rem' }}>
            {summary.overall_feedback}
          </p>
        )}

        {weaknesses.length > 0 && (
          <div style={{ marginBottom: '0.85rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.35rem' }}>Weak areas</p>
            {weaknesses.slice(0, 4).map(function (weakness, index) {
              return <p key={index} className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.2rem' }}>{weakness}</p>
            })}
          </div>
        )}

        {recommendedTopics.length > 0 && (
          <div>
            <p style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.35rem' }}>Recommended practice</p>
            {recommendedTopics.slice(0, 4).map(function (topic, index) {
              return <p key={index} className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.2rem' }}>{topic}</p>
            })}
          </div>
        )}
      </div>
    )
  }

  function renderQuestionFeedback(result) {
    if (!result) return null
    const lostReasons = Array.isArray(result.lost_mark_reasons) ? result.lost_mark_reasons : []
    const recommendedTopics = Array.isArray(result.recommended_mastery_topics) ? result.recommended_mastery_topics : []

    return (
      <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '1.5rem' }}>
        <div className="row" style={{ alignItems: 'baseline', marginBottom: '0.65rem' }}>
          <p style={{ fontWeight: 'bold', marginBottom: 0 }}>Question feedback</p>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {formatMarkValue(result.marks_awarded)} / {formatMarkValue(result.marks_available)} marks
          </span>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}>
          {getResultTone(result.correctness)}{result.error_type ? ' - ' + result.error_type.replace(/_/g, ' ') : ''}
        </p>
        {result.feedback_summary && (
          <p className="muted" style={{ fontSize: '0.9rem', marginBottom: lostReasons.length ? '0.75rem' : 0 }}>
            {result.feedback_summary}
          </p>
        )}
        {lostReasons.length > 0 && (
          <div style={{ marginBottom: recommendedTopics.length ? '0.75rem' : 0 }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.35rem' }}>Lost marks</p>
            {lostReasons.slice(0, 4).map(function (reason, index) {
              return <p key={index} className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.2rem' }}>{reason}</p>
            })}
          </div>
        )}
        {recommendedTopics.length > 0 && (
          <div>
            <p style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.35rem' }}>Practice next</p>
            {recommendedTopics.slice(0, 3).map(function (topic, index) {
              return <p key={index} className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.2rem' }}>{topic}</p>
            })}
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return <div className="page"><p className="muted">Loading pattern data...</p></div>
  }

  if (error) {
    return (
      <div className="page">
        <p className="error-text" style={{ marginBottom: '1rem' }}>{error}</p>
        <button className="secondary" onClick={() => navigate('/patterns')}>Back to Patterns</button>
      </div>
    )
  }

  if (!simulationId && patterns) {
    const examPapers = patterns.papers.filter(p => p.assessment_type === 'Past Exam')
    const topTopics = patterns.topicFrequency.slice(0, 6)

    return (
      <div className="page">
        <div className="row" style={{ marginBottom: '1.5rem' }}>
          <h1>Exam Simulator</h1>
          <span className="spacer" />
          <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/patterns')}>
            Patterns
          </button>
        </div>

        <p className="muted" style={{ marginBottom: '2rem', fontSize: '0.9rem' }}>
          Atlas will generate and save a simulated exam based on patterns detected from {examPapers.length} past paper{examPapers.length !== 1 ? 's' : ''}.
        </p>

        <div style={{ padding: '1.25rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '1.5rem' }}>
          <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: '0.75rem' }}>
            Based on
          </p>
          {examPapers.map(p => (
            <p key={p.id} style={{ fontSize: '0.9rem', marginBottom: '0.2rem' }}>{p.name}</p>
          ))}
        </div>

        <div style={{ padding: '1.25rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '1.5rem' }}>
          <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: '0.75rem' }}>
            Likely topics
          </p>
          {topTopics.map(t => (
            <div key={t.topic} className="row" style={{ padding: '0.3rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
              <span>{t.topic}</span>
              <span className="spacer" />
              <span className="muted">{t.paperCount}/{examPapers.length} papers</span>
            </div>
          ))}
        </div>

        <button className="primary" onClick={generateExam} disabled={generating} style={{ width: '100%', padding: '0.75rem' }}>
          {generating ? 'Atlas is generating your exam...' : 'Generate simulated exam'}
        </button>
      </div>
    )
  }

  if (!exam) {
    return (
      <div className="page">
        <p className="muted">No saved exam found.</p>
        <button className="secondary" onClick={() => navigate('/patterns')}>Back to Patterns</button>
      </div>
    )
  }

  const questions = exam.questions || []
  const currentQuestion = questions[currentQuestionIndex] || questions[0]
  const currentAnswer = answers[currentQuestionIndex] || { answer_text: '', flagged: false }
  const currentResult = markingResults[currentQuestionIndex]
  const remainingMs = getRemainingMs()
  const answeredCount = getAnsweredCount()
  const submitCounts = getSubmitCounts()
  const isAttemptLocked = ['submitted', 'marking', 'marked', 'marking_failed'].includes(simulation?.status)
  const isInProgress = simulation?.status === 'in_progress'

  if (simulation?.status === 'generated') {
    return (
      <div className="page">
        <div className="row" style={{ marginBottom: '1.5rem' }}>
          <h1>{exam.title || 'Simulated Exam'}</h1>
          <span className="spacer" />
          <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/patterns')}>Patterns</button>
        </div>

        <p className="muted" style={{ marginBottom: '2rem' }}>
          This is pressure practice. Once you start, hints stay off and your work is saved as an exam attempt.
        </p>

        <div style={{ padding: '1.25rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 'bold', marginBottom: '0.75rem' }}>Before you start</p>
          <p className="muted" style={{ fontSize: '0.9rem', marginBottom: '0.35rem' }}>
            Flag questions you want to revisit before submitting.
          </p>
          <p className="muted" style={{ fontSize: '0.9rem', marginBottom: '0.35rem' }}>
            Your answers save as you work, so refreshing keeps your attempt.
          </p>
          <p className="muted" style={{ fontSize: '0.9rem', marginBottom: 0 }}>
            The timer starts when you press Start exam.
          </p>
        </div>

        <div style={{ padding: '1.25rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '1.5rem' }}>
          <div className="row" style={{ gap: '2rem', flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: '1.4rem', lineHeight: 1 }}>{exam.timeMinutes || 180}m</p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>Time allowed</p>
            </div>
            <div>
              <p style={{ fontSize: '1.4rem', lineHeight: 1 }}>{questions.length}</p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>Questions</p>
            </div>
            <div>
              <p style={{ fontSize: '1.4rem', lineHeight: 1 }}>{exam.totalMarks || '-'}</p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>Marks</p>
            </div>
          </div>
        </div>

        {exam.instructions?.length > 0 && (
          <div style={{ marginBottom: '2rem' }}>
            <h2>Instructions</h2>
            {exam.instructions.map((inst, i) => (
              <p key={i} className="muted" style={{ fontSize: '0.9rem', marginBottom: '0.25rem' }}>{i + 1}. {inst}</p>
            ))}
          </div>
        )}

        <button className="primary" onClick={startExam} disabled={saving} style={{ width: '100%', padding: '0.75rem' }}>
          {saving ? 'Starting...' : 'Start exam'}
        </button>
      </div>
    )
  }

  return (
    <div style={{
      maxWidth: railCollapsed ? '760px' : '980px',
      margin: '0 auto',
      padding: '2rem 1.5rem 4rem',
      display: 'grid',
      gridTemplateColumns: railCollapsed ? '1fr 44px' : 'minmax(0, 1fr) 220px',
      gap: '1rem'
    }}>
      <main>
        {submitDialogOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-exam-title"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.55)',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1.5rem'
            }}
          >
            <div style={{
              width: 'min(100%, 420px)',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '1.25rem'
            }}>
              <p id="submit-exam-title" style={{ fontWeight: 'bold', marginBottom: '0.65rem' }}>Submit paper?</p>
              <p className="muted" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                Your answers will lock and Atlas will mark the full paper.
              </p>
              <div style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '0.75rem 0', marginBottom: '1rem' }}>
                <div className="row" style={{ marginBottom: '0.35rem' }}>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>Unanswered questions</span>
                  <span className="spacer" />
                  <span>{submitCounts.unanswered}</span>
                </div>
                <div className="row">
                  <span className="muted" style={{ fontSize: '0.85rem' }}>Flagged questions</span>
                  <span className="spacer" />
                  <span>{submitCounts.flagged}</span>
                </div>
              </div>
              <div className="row" style={{ gap: '0.75rem' }}>
                <button className="secondary" onClick={() => setSubmitDialogOpen(false)} disabled={submitting} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button className="primary" onClick={confirmSubmitExam} disabled={submitting} style={{ flex: 1 }}>
                  {submitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="row" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ marginBottom: '0.15rem' }}>Simulated Exam</h1>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Question {currentQuestionIndex + 1} of {questions.length}
              {saving && <span> - Saving...</span>}
            </p>
          </div>
          <span className="spacer" />
          <button className="ghost" style={{ fontSize: '0.85rem' }} onClick={() => navigate('/patterns')}>Patterns</button>
        </div>

        {isAttemptLocked && (
          <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '1.5rem' }}>
            <p style={{ marginBottom: '0.25rem', fontWeight: 'bold' }}>
              {simulation.status === 'marking'
                ? 'Atlas is marking your paper'
                : simulation.status === 'marking_failed'
                ? 'Marking failed'
                : simulation.status === 'marked'
                ? 'Paper marked'
                : 'Paper submitted'}
            </p>
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>
              {simulation.status === 'marking'
                ? 'Your answers are locked while Atlas prepares the marking result.'
                : simulation.status === 'marking_failed'
                ? simulation.marking_error || 'Atlas could not mark this attempt. You can retry marking.'
                : simulation.status === 'marked'
                ? 'Review the estimated marking below, then use it to choose what to practice next.'
                : 'Your answers are locked.'}
            </p>
            {simulation.status === 'marking_failed' && (
              <button className="secondary" onClick={retryMarking} disabled={submitting} style={{ marginTop: '0.75rem' }}>
                {submitting ? 'Retrying...' : 'Retry marking'}
              </button>
            )}
          </div>
        )}

        {simulation.status === 'marked' && renderReportSummary()}

        <div style={{ paddingBottom: '1.5rem', borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
          {currentQuestion && renderQuestion(currentQuestion)}
        </div>

        <label className="label" htmlFor="exam-answer">Answer</label>
        <p className="muted" style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}>
          Enter your final answer. For graphs or sketches, list the key features such as intercepts, turning points, asymptotes, domain, and range.
        </p>
        <textarea
          id="exam-answer"
          value={currentAnswer.answer_text}
          onChange={function (e) { updateAnswer(currentQuestionIndex, e.target.value) }}
          onBlur={function () { flushAnswer(currentQuestionIndex) }}
          disabled={isAttemptLocked}
          rows={10}
          placeholder="Write your working here..."
          style={{ marginBottom: '1rem' }}
        />

        {simulation.status === 'marked' && renderQuestionFeedback(currentResult)}

        <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            className={currentAnswer.flagged ? 'primary' : 'secondary'}
            onClick={function () { toggleFlag(currentQuestionIndex) }}
            disabled={isAttemptLocked}
          >
            {currentAnswer.flagged ? 'Flagged' : 'Flag'}
          </button>
          <span className="spacer" />
          <button className="secondary" onClick={function () { goToQuestion(currentQuestionIndex - 1) }} disabled={currentQuestionIndex === 0}>
            Previous
          </button>
          <button className="primary" onClick={function () { goToQuestion(currentQuestionIndex + 1) }} disabled={currentQuestionIndex >= questions.length - 1}>
            Next
          </button>
        </div>
      </main>

      <aside style={{
        borderLeft: '1px solid var(--border)',
        paddingLeft: railCollapsed ? '0.5rem' : '1rem',
        minHeight: '70vh'
      }}>
        {railCollapsed ? (
          <button className="secondary" style={{ width: '100%', padding: '0.4rem', minHeight: 'unset' }} onClick={() => setRailCollapsed(false)}>
            {answeredCount}/{questions.length}
          </button>
        ) : (
          <div>
            <div className="row" style={{ marginBottom: '1rem' }}>
              <div>
                <p style={{ marginBottom: '0.1rem', fontWeight: 'bold' }}>
                  {isInProgress ? formatDuration(remainingMs) : simulation.status === 'marking' ? 'Marking' : simulation.status === 'marked' ? 'Marked' : 'Submitted'}
                </p>
                <p className="muted" style={{ fontSize: '0.78rem', marginBottom: 0 }}>
                  {answeredCount}/{questions.length} answered
                </p>
              </div>
              <span className="spacer" />
              <button className="ghost" style={{ fontSize: '0.78rem' }} onClick={() => setRailCollapsed(true)}>Collapse</button>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              {questions.map(function (question, index) {
                const answer = answers[index] || {}
                const result = markingResults[index]
                const active = index === currentQuestionIndex
                const answered = (answer.answer_text || '').trim().length > 0
                return (
                  <button
                    key={index}
                    className={active ? 'primary' : 'secondary'}
                    onClick={function () { goToQuestion(index) }}
                    style={{
                      width: '100%',
                      minHeight: 'unset',
                      padding: '0.35rem 0.5rem',
                      marginBottom: '0.35rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.8rem'
                    }}
                  >
                    <span>{getQuestionLabel(question, index)}</span>
                    <span>
                      {result
                        ? `${formatMarkValue(result.marks_awarded)}/${formatMarkValue(result.marks_available)}`
                        : answer.flagged ? 'Flag' : answered ? 'Done' : 'Empty'}
                    </span>
                  </button>
                )
              })}
            </div>

            <button
              className="primary"
              onClick={requestSubmitExam}
              disabled={isAttemptLocked || submitting}
              style={{ width: '100%', fontSize: '0.85rem' }}
            >
              {submitting ? 'Submitting...' : isAttemptLocked ? 'Submitted' : 'Submit paper'}
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}
