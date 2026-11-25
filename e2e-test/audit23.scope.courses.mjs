import { act, ADMIN_EMAIL, ADMIN_PASSWORD, URL, mut, q } from './lib.mjs'

const sign = await act('auth:signIn', {
  provider: 'password',
  params: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, flow: 'signIn' },
})
const token = sign?.tokens?.token
const t = token

async function rawCall(kind, path, args) {
  const res = await fetch(`${URL}/api/${kind}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${t}`,
    },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text); }
  catch (e) { return { status: res.status, text: text.slice(0, 400) } }
  if (json.status === 'error') {
    return { status: res.status, error: json.errorMessage?.slice(0, 500) ?? text }
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
  ['adminAnalytics:getInstitutionPerformance', { id: 'mh771k7xh059qpxfqwz19n2yk18jtewk' }],
  ['adminAnalytics:getTeachingCenterPerformance', { id: 'mh771k7xh059qpxfqwz19n2yk18jtewk' }],
  ['adminAnalytics:getFacilityPerformance', { id: 'mh771k7xh059qpxfqwz19n2yk18jtewk' }],
  ['adminAnalytics:getStudentPerformance', { id: 'mx771jacw4qe5y365weseh5grn8jvrvb' }],
  ['adminAnalytics:getInstructorPerformance', { id: 'ms7688s8ns62qyeq4ss0gd4azh8jtw2c' }],
  ['adminAnalytics:getSystemAnalytics', {}],
  ['adminAnalytics:listAuditLogs', { limit: 3 }],
]

for (const entry of probe) {
  const path = entry[0]
  const args = entry[1] ?? {}
  const r = await rawCall('query', path, args)
  console.log(JSON.stringify({ path, args, r }))
}
