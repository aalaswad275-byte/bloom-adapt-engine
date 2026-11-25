import { act, ADMIN_EMAIL, ADMIN_PASSWORD, URL } from './lib.mjs'

const sign = await act('auth:signIn', {
  provider: 'password',
  params: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, flow: 'signIn' },
})
const token = sign?.tokens?.token

async function rawCall(kind, path, args) {
  const res = await fetch(`${URL}/api/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ path, args: args ?? {}, format: 'json' }),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text); }
  catch { return { status: res.status, text: text.slice(0, 500) } }
  if (json.status === 'error') {
    return { status: res.status, error: json.errorMessage?.slice(0, 400) ?? text }
  }
  return { status: res.status, value: json.value }
}

const probe = [
  ['adminCourses:listCourses', {}],
  ['adminCourses:listCourseModules', {}],
  ['adminCourses:listQuestionCategories', {}],
  ['adminCourses:listQuestionTopics', {}],
  ['adminCourses:listQuestionTypes', {}],
  ['adminCourses:listQuestions', {}],
  ['adminCourses:listExams', {}],
  ['adminAnalytics:listAdminAssessments', {}],
  ['adminAnalytics:getAdminDashboard', {}],
  ['instructorPortal:getInstructorViewer', {}],
]

for (let i = 0; i < probe.length; i++) {
  const entry = probe[i]
  const path = entry[0]
  const args = entry[1] ?? {}
  const r = await rawCall('query', path, args)
  console.log(JSON.stringify({ path, args, r }))
}
