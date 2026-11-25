import { act, q, ADMIN_EMAIL, ADMIN_PASSWORD } from './lib.mjs'

const token = await act('auth:signIn', {
  provider: 'password',
  params: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, flow: 'signIn' },
})

console.log('listAuditLogs sample', JSON.stringify(await q('adminAnalytics:listAuditLogs', { limit: 1, search: 'course' }, token.tokens.token)).slice(0, 400))
console.log('listAdminAssessments sample', JSON.stringify((await q('adminAnalytics:listAdminAssessments', {}, token.tokens.token))?.slice(0, 3) ?? []))

console.log('=== now listing all admin-backed entities ===')
const [inst, centers, facilities, instructors, students, classes, examRecords, sessions, assessments, quesCat, quesTopic, quoType, questions] = await Promise.all([
  q('adminPeople:listInstitutions', {}, token.tokens.token),
  q('adminPeople:listTeachingCenters', {}, token.tokens.token),
  q('adminPeople:listGovernmentFacilities', {}, token.tokens.token),
  q('adminPeople:listInstructors', {}, token.tokens.token),
  q('adminPeople:listStudents', {}, token.tokens.token),
  q('adminClasses:listClasses', {}, token.tokens.token),
  q('exams:listExams', {}, token.tokens.token),
  q('adminAnalytics:getAdminDashboard', {}, token.tokens.token),
  q('adminAnalytics:listAdminAssessments', {}, token.tokens.token),
  q('adminCourses:listQuestionCategories', {}, token.tokens.token),
  q('adminCourses:listQuestionTopics', {}, token.tokens.token),
  q('adminCourses:listQuestionTypes', {}, token.tokens.token),
  q('adminCourses:listQuestions', {}, token.tokens.token),
])

console.log(JSON.stringify({ institutions: inst.length, centers: centers.length, facilities: facilities.length, instructors: instructors.length, students: students.length, classes: classes.length, exams: examRecords.length, sessions: sessions?.length ?? 0, assessments: assessments?.length ?? 0, categories: quesCat?.length ?? 0, topics: quesTopic?.length ?? 0, questionTypes: quoType?.length ?? 0, questions: questions?.length ?? 0 }, null, 2))
console.log(JSON.stringify({ institutions: quesCat, centers, facilities, instructors: instructors.map(i=>i.name), students: students.map(s=>s.name).slice(0,3), classes: classes.map(c=>c.name), exams, assessments, categories: quesCat, topics: quesTopic, questionTypes: quoType, questions: questions?.slice(0,5) }, null, 2))
