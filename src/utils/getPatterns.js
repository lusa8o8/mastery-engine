import { supabase } from '../api/supabase'

// Compute confidence score from pattern data
export function computeConfidence(papers, questions) {
  if (!papers.length || !questions.length) return 0

  const examPapers = papers.filter(p => p.assessment_type === 'Past Exam')

  // Factor 1: Paper count (30% weight)
  const paperCount = examPapers.length
  const paperFactor = paperCount === 0 ? 0 : paperCount === 1 ? 0.3 : paperCount === 2 ? 0.6 : 1.0

  // Factor 2: Marks coverage (25% weight)
  const examQuestions = questions.filter(q =>
    examPapers.some(p => p.id === q.paper_id)
  )
  const withMarks = examQuestions.filter(q => q.marks !== null).length
  const marksFactor = examQuestions.length > 0 ? withMarks / examQuestions.length : 0

  // Factor 3: Question number completeness (20% weight)
  const withQNum = examQuestions.filter(q => q.question_number !== null).length
  const qNumFactor = examQuestions.length > 0 ? withQNum / examQuestions.length : 0

  // Factor 4: Topic breadth (25% weight)
  const uniqueSubTypes = new Set(examQuestions.map(q => q.sub_type)).size
  const breadthFactor = Math.min(uniqueSubTypes / 20, 1.0)

  const score = (
    paperFactor * 0.30 +
    marksFactor * 0.25 +
    qNumFactor * 0.20 +
    breadthFactor * 0.25
  )

  return Math.round(score * 100)
}

export function getConfidenceLevel(score) {
  if (score < 40) return { level: 'insufficient', label: 'Insufficient data', color: 'var(--error)' }
  if (score < 70) return { level: 'low', label: 'Low confidence', color: '#c4913a' }
  if (score < 90) return { level: 'moderate', label: 'Moderate confidence', color: '#6b9e6b' }
  return { level: 'high', label: 'High confidence', color: 'var(--success)' }
}

export function getConfidenceBreakdown(papers, questions) {
  const examPapers = papers.filter(p => p.assessment_type === 'Past Exam')
  const examQuestions = questions.filter(q =>
    examPapers.some(p => p.id === q.paper_id)
  )

  const paperCount = examPapers.length
  const withMarks = examQuestions.filter(q => q.marks !== null).length
  const withQNum = examQuestions.filter(q => q.question_number !== null).length
  const uniqueSubTypes = new Set(examQuestions.map(q => q.sub_type)).size

  return {
    papers: {
      count: paperCount,
      score: Math.round((paperCount === 0 ? 0 : paperCount === 1 ? 0.3 : paperCount === 2 ? 0.6 : 1.0) * 100),
      label: `${paperCount} Past Exam paper${paperCount !== 1 ? 's' : ''}`,
      tip: paperCount < 3 ? `Add ${3 - paperCount} more Past Exam paper${3 - paperCount !== 1 ? 's' : ''} to maximize this factor` : null
    },
    marks: {
      count: withMarks,
      total: examQuestions.length,
      score: examQuestions.length > 0 ? Math.round((withMarks / examQuestions.length) * 100) : 0,
      label: `${withMarks}/${examQuestions.length} questions have mark allocations`,
      tip: withMarks < examQuestions.length ? 'Upload clean PDF versions of papers to improve mark extraction' : null
    },
    structure: {
      count: withQNum,
      total: examQuestions.length,
      score: examQuestions.length > 0 ? Math.round((withQNum / examQuestions.length) * 100) : 0,
      label: `${withQNum}/${examQuestions.length} questions have question numbers`,
      tip: null
    },
    breadth: {
      count: uniqueSubTypes,
      score: Math.round(Math.min(uniqueSubTypes / 20, 1.0) * 100),
      label: `${uniqueSubTypes} unique sub-topics across exam papers`,
      tip: uniqueSubTypes < 20 ? 'More papers will reveal more sub-topic patterns' : null
    }
  }
}

// Compute topic frequency across exam papers
export function computeTopicFrequency(papers, questions) {
  const examPapers = papers.filter(p => p.assessment_type === 'Past Exam')
  const examQuestions = questions.filter(q =>
    examPapers.some(p => p.id === q.paper_id)
  )

  const topicMap = {}
  for (const q of examQuestions) {
    if (!topicMap[q.topic]) {
      topicMap[q.topic] = { topic: q.topic, count: 0, papers: new Set(), subtypes: {} }
    }
    topicMap[q.topic].count++
    topicMap[q.topic].papers.add(q.paper_id)
    if (!topicMap[q.topic].subtypes[q.sub_type]) {
      topicMap[q.topic].subtypes[q.sub_type] = { count: 0, papers: new Set() }
    }
    topicMap[q.topic].subtypes[q.sub_type].count++
    topicMap[q.topic].subtypes[q.sub_type].papers.add(q.paper_id)
  }

  return Object.values(topicMap)
    .map(t => ({
      topic: t.topic,
      count: t.count,
      paperCount: t.papers.size,
      subtypes: Object.entries(t.subtypes)
        .map(([sub_type, s]) => ({
          sub_type,
          count: s.count,
          paperCount: s.papers.size,
          isFavourite: s.papers.size >= Math.min(2, examPapers.length)
        }))
        .sort((a, b) => b.count - a.count)
    }))
    .sort((a, b) => b.paperCount - a.paperCount || b.count - a.count)
}

// Compute question position patterns (which topics appear in Q1, Q2 etc.)
export function computePositionPatterns(papers, questions) {
  const examPapers = papers.filter(p => p.assessment_type === 'Past Exam')
  const examQuestions = questions.filter(q =>
    examPapers.some(p => p.id === q.paper_id) && q.question_number
  )

  const positionMap = {}
  for (const q of examQuestions) {
    const topLevel = q.question_number.match(/^(\d+)/)?.[1]
    if (!topLevel) continue
    if (!positionMap[topLevel]) positionMap[topLevel] = {}
    if (!positionMap[topLevel][q.topic]) positionMap[topLevel][q.topic] = 0
    positionMap[topLevel][q.topic]++
  }

  return Object.entries(positionMap)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([position, topics]) => ({
      position: `Q${position}`,
      topics: Object.entries(topics)
        .sort(([, a], [, b]) => b - a)
        .map(([topic, count]) => ({ topic, count }))
    }))
}

// Compute mark allocation patterns per topic
export function computeMarkPatterns(papers, questions) {
  const examPapers = papers.filter(p => p.assessment_type === 'Past Exam')
  const examQuestions = questions.filter(q =>
    examPapers.some(p => p.id === q.paper_id) && q.marks !== null
  )

  if (examQuestions.length === 0) return []

  const topicMarks = {}
  for (const q of examQuestions) {
    if (!topicMarks[q.topic]) topicMarks[q.topic] = []
    topicMarks[q.topic].push(q.marks)
  }

  return Object.entries(topicMarks)
    .map(([topic, marks]) => ({
      topic,
      totalMarks: marks.reduce((s, m) => s + m, 0),
      avgMarks: Math.round(marks.reduce((s, m) => s + m, 0) / marks.length),
      count: marks.length
    }))
    .sort((a, b) => b.totalMarks - a.totalMarks)
}

// Main function — fetches all data needed for pattern analysis
export async function getPatterns(userId) {
  // Get all papers with assessment type
  const { data: papersData, error: papersError } = await supabase
    .from('papers')
    .select('id, name, assessment_type, uploaded_at, instructions, time_minutes, total_questions, attempt_questions, calculators_allowed')
    .eq('user_id', userId)
    .order('uploaded_at', { ascending: false })

  if (papersError) throw papersError

  const papers = papersData || []
  const paperIds = papers.map(p => p.id)

  if (paperIds.length === 0) return {
    papers: [],
    questions: [],
    confidence: 0,
    confidenceLevel: getConfidenceLevel(0),
    breakdown: null,
    topicFrequency: [],
    positionPatterns: [],
    markPatterns: []
  }

  // Get all extracted questions for these papers
  const { data: questionsData, error: questionsError } = await supabase
    .from('questions')
    .select('id, paper_id, topic, sub_type, question_number, marks, raw_text')
    .eq('user_id', userId)
    .eq('source', 'extracted')
    .in('paper_id', paperIds)

  if (questionsError) throw questionsError

  const questions = questionsData || []

  const confidence = computeConfidence(papers, questions)

  return {
    papers,
    questions,
    confidence,
    confidenceLevel: getConfidenceLevel(confidence),
    breakdown: getConfidenceBreakdown(papers, questions),
    topicFrequency: computeTopicFrequency(papers, questions),
    positionPatterns: computePositionPatterns(papers, questions),
    markPatterns: computeMarkPatterns(papers, questions)
  }
}

