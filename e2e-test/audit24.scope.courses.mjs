import { act, ADMIN_EMAIL, ADMIN_PASSWORD, URL } from './lib.mjs'

const sign = await act('auth:signIn', {
  provider: 'password',
  params: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, flow: 'signIn' },
})
const token = sign?.tokens?.token

async function rawCall(kind, path, args) {
  const res = await fetch(`${URL}/api/${kind}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text); }
  catch (e) { return { status: res.status, text: text.slice(0, 500) } }
  if (json.status === 'error') {
    return { status: res.status, error: json.errorMessage?.slice(0, 500) ?? text }
  }
  return { status: res.status, value: json.value }
}

const mutations = [
  ['adminCourses:listCourses', {}],
  ['adminCourses:listCourseModules', {}],
  ['adminCourses:createCourse', {}],
  ['adminCourses:updateCourse', {}],
  ['adminCourses:deleteCourse', {}],
  ['adminCourses:getCourseModules', {}],
  ['adminCourses:listQuestionCategories', {}],
  ['adminCourses:listQuestionTopics', {}],
  ['adminCourses:listQuestionTypes', {}],
  ['adminCourses:listQuestions', {}],
  ['adminCourses:createQuestion', {}],
  ['adminCourses:updateQuestion', {}],
  ['adminCourses:deleteQuestion', {}],
  ['adminCourses:listExams', {}],
  ['adminCourses:createExam', {}],
  ['adminCourses:updateExam', {}],
  ['adminCourses:deleteExam', {}],
  ['adminCourses:listCourseQuestions', {}],
  ['adminCourses:listCourseModules', {}],
  ['adminCourses:listQuestionCategories', {}],
  ['adminCourses:listQuestionTopics', {}],
  ['adminCourses:listQuestionTypes', {}],
  ['adminCourses:listQuestions', {}],
  ['adminCourses:createQuestionCategory', {}],
  ['adminCourses:createQuestionTopic', {}],
  ['adminCourses:createQuestionType', {}],
  ['adminCourses:listQuestionCategories', {}],
  ['adminCourses:listQuestionTopics', {}],
  ['adminCourses:listQuestionTypes', {}],
  ['adminCourses:listQuestions', {}],
  ['adminCourses:createQuestionCategory', { name: 'test' }],
  ['adminCourses:createQuestionTopic', { name: 'test' }],
  ['adminCourses:createQuestionType', { name: 'test' }],
  ['adminCourses:listQuestionCategories', {}],
  ['adminCourses:listQuestionTopics', {}],
  ['adminCourses:listQuestionTypes', {}],
  ['adminCourses:listQuestions', {}],
]

for (const [path, args] of mutations) {
  const r = await rawCall('mutation', path, args ?? {})
  console.log(JSON.stringify({ path, args, r }))
}
