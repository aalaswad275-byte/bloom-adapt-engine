import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type Language = "en" | "ar";

const STORAGE_KEY = "adaptivemind.language";

/**
 * Centralized UI dictionary. Keys are the canonical English UI strings so
 * components can either call t("English label") or keep their existing text
 * and let the translator render the Arabic form. Question content is never
 * translated through this dictionary — it comes from the bilingual fields on
 * the question row.
 */
export const translations: Record<Language, Record<string, string>> = {
  en: {},
  ar: {
    // Shell, navigation, and common actions
    Dashboard: "لوحة التحكم",
    "Admin console": "لوحة الإدارة",
    "Instructor portal": "بوابة المعلم",
    "Instructor Portal": "بوابة المعلم",
    "Student portal": "بوابة الطالب",
    "My class": "صفي",
    "My Class": "صفي",
    "Sign in": "تسجيل الدخول",
    "Sign up": "إنشاء حساب",
    "Sign out": "تسجيل الخروج",
    "Sign In": "تسجيل الدخول",
    "Sign Up": "إنشاء حساب",
    "Sign Out": "تسجيل الخروج",
    "Log in": "تسجيل الدخول",
    "Log out": "تسجيل الخروج",
    "Create account": "إنشاء حساب",
    "Back to dashboard": "العودة إلى لوحة التحكم",
    "Back to my class": "العودة إلى صفي",
    "Back to results": "العودة إلى النتائج",
    Save: "حفظ",
    "Save changes": "حفظ التغييرات",
    Cancel: "إلغاء",
    Close: "إغلاق",
    Delete: "حذف",
    Edit: "تعديل",
    Add: "إضافة",
    Create: "إنشاء",
    Continue: "متابعة",
    Next: "التالي",
    Previous: "السابق",
    Back: "رجوع",
    Submit: "إرسال",
    Search: "بحث",
    Filter: "تصفية",
    "Clear filters": "مسح التصفية",
    "All": "الكل",
    "All statuses": "كل الحالات",
    "No results": "لا توجد نتائج",
    "No data": "لا توجد بيانات",
    "Loading...": "جارٍ التحميل...",
    Loading: "جارٍ التحميل",
    Error: "خطأ",
    Retry: "إعادة المحاولة",
    Yes: "نعم",
    No: "لا",
    True: "صحيح",
    False: "خطأ",
    Actions: "الإجراءات",
    Status: "الحالة",
    Active: "نشط",
    Inactive: "غير نشط",
    Archived: "مؤرشف",
    Draft: "مسودة",
    Published: "منشور",
    Closed: "مغلق",
    Completed: "مكتمل",
    Incomplete: "غير مكتمل",
    Pending: "قيد الانتظار",
    Passed: "ناجح",
    Failed: "راسب",
    Pass: "نجاح",
    Fail: "رسوب",
    Total: "الإجمالي",
    Average: "المتوسط",
    Highest: "الأعلى",
    Lowest: "الأدنى",
    Score: "الدرجة",
    Marks: "العلامات",
    Grade: "التقدير",
    Percentage: "النسبة",
    Students: "الطلاب",
    Student: "الطالب",
    Instructors: "المعلمون",
    Instructor: "المعلم",
    Classes: "الصفوف",
    Class: "الصف",
    Assessments: "التقييمات",
    Assessment: "التقييم",
    Exams: "الاختبارات",
    Exam: "الاختبار",
    Questions: "الأسئلة",
    Question: "السؤال",
    "Question bank": "بنك الأسئلة",
    "Question Bank": "بنك الأسئلة",
    Reports: "التقارير",
    Results: "النتائج",
    Analytics: "التحليلات",
    Settings: "الإعدادات",
    "Audit logs": "سجلات التدقيق",
    "Student results": "نتائج الطلاب",
    "Student Results": "نتائج الطلاب",
    Performance: "الأداء",
    Attendance: "الحضور",
    Monitoring: "المراقبة",
    Proctoring: "المراقبة",
    "Question taxonomy": "تصنيف الأسئلة",
    "Shared questions": "الأسئلة المشتركة",
    Institutions: "المؤسسات",
    "Teaching centers": "مراكز التعليم",
    "Government facilities": "المرافق الحكومية",
    "Institution": "المؤسسة",
    "Teaching center": "مركز التعليم",
    "Government facility": "مرفق حكومي",
    "User management": "إدارة المستخدمين",
    "Profile": "الملف الشخصي",
    "Change password": "تغيير كلمة المرور",
    "Email": "البريد الإلكتروني",
    "Password": "كلمة المرور",
    "New password": "كلمة المرور الجديدة",
    "Current password": "كلمة المرور الحالية",
    "Confirm password": "تأكيد كلمة المرور",
    "Name": "الاسم",
    "Phone": "الهاتف",
    "Subject": "المادة",
    "Topic": "الموضوع",
    "Description": "الوصف",
    "Title": "العنوان",
    "Date": "التاريخ",
    "Time": "الوقت",
    "Duration": "المدة",
    "Start": "البداية",
    "End": "النهاية",
    "Open": "فتح",
    "View": "عرض",
    "View details": "عرض التفاصيل",
    "View results": "عرض النتائج",
    "View report": "عرض التقرير",
    "Download": "تنزيل",
    "Export": "تصدير",
    "Print": "طباعة",
    "Refresh": "تحديث",
    "Language": "اللغة",
    "English": "English",
    "العربية": "العربية",
    "Switch language": "تغيير اللغة",

    // Landing
    "Adaptive assessment, built around Bloom's taxonomy": "تقييم تكيفي مبني على تصنيف بلوم",
    "Sign in to begin": "سجّل الدخول للبدء",
    "Enter the examination": "ادخل الاختبار",
    "Take an exam": "ابدأ اختباراً",
    "Your progress": "تقدمك",
    "How it works": "كيف يعمل",
    "Features": "المزايا",
    "Start assessment": "ابدأ التقييم",
    "Explore the dashboard": "استكشف لوحة التحكم",
    "Six-dimensional ability profile": "ملف قدرات من ستة أبعاد",
    "Adaptive question selection": "اختيار تكيفي للأسئلة",
    "Integrity monitoring": "مراقبة النزاهة",
    "Detailed reports": "تقارير مفصلة",

    // Authentication
    "Welcome back": "مرحباً بعودتك",
    "Create your account": "أنشئ حسابك",
    "Email address": "البريد الإلكتروني",
    "Enter your email": "أدخل بريدك الإلكتروني",
    "Enter your password": "أدخل كلمة المرور",
    "Forgot password?": "نسيت كلمة المرور؟",
    "Don't have an account?": "ليس لديك حساب؟",
    "Already have an account?": "لديك حساب بالفعل؟",
    "Sign in to your account": "سجّل الدخول إلى حسابك",
    "Continue with email": "المتابعة بالبريد الإلكتروني",
    "Invalid email or password": "البريد الإلكتروني أو كلمة المرور غير صحيحة",
    "Authentication required": "يلزم تسجيل الدخول",
    "Sign in required": "يلزم تسجيل الدخول",
    "Please sign in to continue": "يرجى تسجيل الدخول للمتابعة",

    // Dashboard
    "Your adaptive journey": "رحلتك التكيفية",
    "Available exams": "الاختبارات المتاحة",
    "Your recent sessions": "جلساتك الأخيرة",
    "Your latest ability profile": "أحدث ملف قدرات لك",
    "No exams available": "لا توجد اختبارات متاحة",
    "Start exam": "ابدأ الاختبار",
    "Resume exam": "استئناف الاختبار",
    "Review results": "مراجعة النتائج",
    "Questions answered": "الأسئلة المجابة",
    "Correct answers": "الإجابات الصحيحة",
    "Accuracy": "الدقة",
    "Bloom profile": "ملف بلوم",
    "Ability estimate": "تقدير القدرة",
    "Standard error": "الخطأ المعياري",
    "Risk score": "درجة المخاطر",
    "Session": "الجلسة",
    "Session complete": "اكتملت الجلسة",
    "Session terminated": "تم إنهاء الجلسة",
    "Session paused": "تم إيقاف الجلسة مؤقتاً",
    "In progress": "قيد التقدم",
    "Not started": "لم يبدأ",
    "Terminated": "منتهي",

    // Examination runner
    "Building your initial six-dimensional Bloom profile…": "جارٍ بناء ملف بلوم الأولي الخاص بك...",
    "Building your initial six-dimensional Bloom profile": "جارٍ بناء ملف بلوم الأولي الخاص بك",
    "of": "من",
    "answered": "تمت الإجابة",
    "expected": "الوقت المتوقع",
    "Submit answer": "إرسال الإجابة",
    "Submit Answer": "إرسال الإجابة",
    "Next question": "السؤال التالي",
    "Previous question": "السؤال السابق",
    "Skip": "تخطي",
    "Skip question": "تخطي السؤال",
    "Skip this question?": "هل تريد تخطي هذا السؤال؟",
    "Keep answering": "متابعة الإجابة",
    "Type your answer… numbers, code output, paragraphs, Arabic and English are supported": "اكتب إجابتك... الأرقام ومخرجات البرمجة والفقرات والعربية والإنجليزية مدعومة",
    "Type your answer… Arabic and English paragraphs are supported": "اكتب إجابتك... الفقرات العربية والإنجليزية مدعومة",
    "Type your answer…": "اكتب إجابتك...",
    "Your full response is saved exactly as written. Evaluation is semantic where available; otherwise it is queued for manual grading.": "تُحفظ إجابتك كاملة كما كتبتها. ويتم تقييمها دلالياً عند الإمكان، وإلا تُحال إلى التصحيح اليدوي.",
    "Your full response is saved exactly as written.": "تُحفظ إجابتك كاملة كما كتبتها.",
    "Answer saved — you'll see every question and answer on your results page.": "تم حفظ الإجابة — سترى كل الأسئلة والإجابات في صفحة النتائج.",
    "Answer hidden — you'll see every question and answer on your results page.": "الإجابة مخفية — سترى كل الأسئلة والإجابات في صفحة النتائج.",
    "Your written answer has been saved. Automatic semantic evaluation is unavailable, so it is pending manual grading. You can continue to the next question.": "تم حفظ إجابتك المكتوبة. التقييم الدلالي التلقائي غير متاح حالياً، لذا ستتم مراجعتها يدوياً. يمكنك الانتقال إلى السؤال التالي.",
    "saved · pending review": "محفوظة · بانتظار المراجعة",
    "correct": "صحيحة",
    "incorrect": "غير صحيحة",
    "Correct": "صحيحة",
    "Incorrect": "غير صحيحة",
    "Partially correct": "صحيحة جزئياً",
    "Answer:": "الإجابة:",
    "Correct answer": "الإجابة الصحيحة",
    "Correct answer:": "الإجابة الصحيحة:",
    "Explanation": "التوضيح",
    "Explanation (optional)": "التوضيح (اختياري)",
    "Shown in student results": "يظهر في نتائج الطالب",
    "Please enter an answer before submitting.": "يرجى إدخال إجابة قبل الإرسال.",
    "Submission failed — please retry": "فشل الإرسال — يرجى المحاولة مرة أخرى",
    "Exam completed": "اكتمل الاختبار",
    "Exam terminated": "تم إنهاء الاختبار",
    "Exam paused": "تم إيقاف الاختبار مؤقتاً",
    "Your answers are saved. Open your report when you are ready — you will not be redirected automatically.": "تم حفظ إجاباتك. افتح تقريرك عندما تكون مستعداً — لن يتم تحويلك تلقائياً.",
    "Leave and view report": "المغادرة وعرض التقرير",
    "All questions & answers": "جميع الأسئلة والإجابات",
    "Complete review of every item served this session": "مراجعة كاملة لكل سؤال في هذه الجلسة",
    "manual review": "مراجعة يدوية",
    "skipped": "تم تخطيها",
    "Incorrect answers": "الإجابات غير الصحيحة",
    "Weakest Bloom areas": "أضعف مجالات بلوم",
    "Ability profile": "ملف القدرات",
    "Session summary": "ملخص الجلسة",
    "Integrity report": "تقرير النزاهة",
    "Time strain": "ضغط الوقت",
    "Visual mismatch": "عدم تطابق بصري",
    "Predicted probability": "الاحتمال المتوقع",
    "Item information": "معلومات السؤال",
    "Effective difficulty": "الصعوبة الفعلية",
    "Adaptive action": "الإجراء التكيفي",
    "Difficulty change": "تغير الصعوبة",
    "Bloom transition": "انتقال بلوم",
    "Research log": "سجل البحث",

    // Monitoring
    "Camera": "الكاميرا",
    "connected": "متصل",
    "error": "خطأ",
    "starting": "جارٍ البدء",
    "Identity": "الهوية",
    "Verified": "تم التحقق",
    "Persons": "الأشخاص",
    "Not detected": "لم يتم اكتشافه",
    "Visible": "ظاهر",
    "In use": "قيد الاستخدام",
    "Attention": "الانتباه",
    "Normal": "طبيعي",
    "Looking away": "ينظر بعيداً",
    "Browser focus": "تركيز المتصفح",
    "Lost": "مفقود",
    "engine": "المحرك",
    "face detector": "كاشف الوجه",
    "You visible": "ظهورك",
    "Others in frame": "آخرون في الإطار",
    "None": "لا يوجد",
    "Detected": "تم اكتشافه",
    "Warning": "تحذير",
    "Warning:": "تحذير:",
    "Please keep the exam window focused.": "يرجى إبقاء نافذة الاختبار في المقدمة.",
    "Please stay on the examination page.": "يرجى البقاء في صفحة الاختبار.",
    "You must remain visible to the camera.": "يجب أن تبقى ظاهراً أمام الكاميرا.",
    "Please keep your face visible to the camera.": "يرجى إبقاء وجهك ظاهراً للكاميرا.",
    "Another person was detected in the frame. You must be alone.": "تم اكتشاف شخص آخر في الإطار. يجب أن تكون وحدك.",
    "A mobile phone was detected. Please put it away.": "تم اكتشاف هاتف محمول. يرجى إبعاده.",
    "The camera was disconnected or disabled.": "تم فصل الكاميرا أو تعطيلها.",
    "The camera feed could not be analyzed.": "تعذر تحليل بث الكاميرا.",

    // Instructor / admin
    "New question": "سؤال جديد",
    "Edit question": "تعديل السؤال",
    "Add question": "إضافة سؤال",
    "Question text": "نص السؤال",
    "Question text (Arabic)": "نص السؤال بالعربية",
    "Instructions": "التعليمات",
    "Instructions (English)": "التعليمات بالإنجليزية",
    "Instructions (Arabic)": "التعليمات بالعربية",
    "Question type": "نوع السؤال",
    "Correct answer (Arabic)": "الإجابة الصحيحة بالعربية",
    "Options": "الخيارات",
    "Options (Arabic)": "الخيارات بالعربية",
    "Add option": "إضافة خيار",
    "Option": "خيار",
    "Mark as correct": "تعيين كإجابة صحيحة",
    "Bloom's level": "مستوى بلوم",
    "Bloom level": "مستوى بلوم",
    "Difficulty level": "مستوى الصعوبة",
    "Expected answer time": "الوقت المتوقع للإجابة",
    "Subject / category": "المادة / التصنيف",
    "General / no topic": "عام / بدون موضوع",
    "General": "عام",
    "Choose a type": "اختر النوع",
    "Choose a subject": "اختر المادة",
    "Multiple choice": "اختيار من متعدد",
    "True / False": "صح / خطأ",
    "Short answer": "إجابة قصيرة",
    "Drag and drop": "السحب والإفلات",
    "Ordering": "الترتيب",
    "New assessment": "تقييم جديد",
    "Create assessment": "إنشاء تقييم",
    "Create draft": "إنشاء مسودة",
    "Publish": "نشر",
    "Unpublish": "إلغاء النشر",
    "Archive": "أرشفة",
    "Restore": "استعادة",
    "Schedule": "جدولة",
    "Questions in": "الأسئلة في",
    "Questions in “": "الأسئلة في «",
    "Add questions": "إضافة أسئلة",
    "Question pool": "مجمّع الأسئلة",
    "Display count": "عدد الأسئلة المعروضة",
    "Time limit": "الحد الزمني",
    "Pass threshold": "حد النجاح",
    "Overall results": "النتائج الإجمالية",
    "Class performance": "أداء الصف",
    "Student performance": "أداء الطالب",
    "Improvement": "التحسن",
    "Adaptive improvement": "التحسن التكيفي",
    "Attendance and monitoring": "الحضور والمراقبة",
    "Reports and exports": "التقارير والتصدير",
    "Roster": "قائمة الطلاب",
    "Enrolled students": "الطلاب المسجلون",
    "Add student": "إضافة طالب",
    "Import students": "استيراد الطلاب",
    "No students yet": "لا يوجد طلاب بعد",
    "No classes yet": "لا توجد صفوف بعد",
    "No assessments yet": "لا توجد تقييمات بعد",
    "No questions yet": "لا توجد أسئلة بعد",
    "Search questions": "بحث في الأسئلة",
    "Search students": "بحث في الطلاب",
    "Search classes": "بحث في الصفوف",
    "All difficulty levels": "كل مستويات الصعوبة",
    "All Bloom levels": "كل مستويات بلوم",
    "Created": "تم الإنشاء",
    "Updated": "تم التحديث",
    "Owner": "المالك",
    "Author": "المؤلف",
    "Shared": "مشترك",
    "Private": "خاص",
    "Export CSV": "تصدير CSV",
    "Download report": "تنزيل التقرير",
    "Print report": "طباعة التقرير",
    "Report language": "لغة التقرير",
    "Arabic": "العربية",
    "Overall pass rate": "نسبة النجاح الإجمالية",
    "Overall average": "المتوسط الإجمالي",
    "Completed attempts": "المحاولات المكتملة",
    "Total students": "إجمالي الطلاب",
    "Total attempts": "إجمالي المحاولات",
    "Terminated attempts": "المحاولات المنتهية",
    "Average score": "متوسط الدرجة",
    "Average percentage": "متوسط النسبة",
    "Pass rate": "نسبة النجاح",
    "Highest score": "أعلى درجة",
    "Lowest score": "أدنى درجة",
    "Student name": "اسم الطالب",
    "Student ID": "رقم الطالب",
    "Class name": "اسم الصف",
    "Assessment title": "عنوان التقييم",
    "Submitted at": "وقت الإرسال",
    "Started at": "وقت البدء",
    "Completed at": "وقت الإكمال",
    "Risk": "المخاطر",
  },
};

// Additional page/module labels. Kept in one place so the entire existing UI
// can participate without duplicating translation objects across pages.
Object.assign(translations.ar, {
  "Overview": "نظرة عامة",
  "Admin overview": "نظرة عامة للإدارة",
  "Platform overview": "نظرة عامة على المنصة",
  "Quick actions": "إجراءات سريعة",
  "Recent activity": "النشاط الأخير",
  "Nothing yet.": "لا شيء بعد.",
  "Active vs inactive students": "الطلاب النشطون وغير النشطين",
  "Student enrollment over time": "تسجيل الطلاب عبر الوقت",
  "Students by institution": "الطلاب حسب المؤسسة",
  "Students by teaching center": "الطلاب حسب مركز التعليم",
  "Students by government facility": "الطلاب حسب المرفق الحكومي",
  "Performance trend (avg score by month)": "اتجاه الأداء (متوسط الدرجة شهرياً)",
  "Full name": "الاسم الكامل",
  "Unassigned": "غير معيّن",
  "All instructors": "كل المعلمين",
  "All assessments": "كل التقييمات",
  "All institutions": "كل المؤسسات",
  "All levels": "كل المستويات",
  "All students": "كل الطلاب",
  "Below": "أقل من",
  "Excellent": "ممتاز",
  "Good": "جيد",
  "Poor": "ضعيف",
  "Integrity": "النزاهة",
  "Question-by-question progression": "التقدم سؤالاً بسؤال",
  "Institution filter": "تصفية المؤسسة",
  "Report type": "نوع التقرير",
  "My classes": "صفوفي",
  "Confirm adding student": "تأكيد إضافة الطالب",
  "Create a class": "إنشاء صف",
  "No matching student": "لا يوجد طالب مطابق",
  "Register new": "تسجيل جديد",
  "Search existing": "بحث عن موجود",
  "Sign in as instructor": "تسجيل الدخول كمعلم",
  "Sign in as student": "تسجيل الدخول كطالب",
  "No completed exams yet": "لا توجد اختبارات مكتملة بعد",
  "No joined classes yet": "لم تنضم إلى صفوف بعد",
  "Score trend": "اتجاه الدرجات",
  "Student space": "مساحة الطالب",
  "You're all caught up": "لا توجد مهام متبقية",
  "Your class": "صفك",
  "Bloom ability profile": "ملف قدرات بلوم",
  "How to read θ": "كيف تقرأ θ",
  "Your sessions": "جلساتك",
  "Start an adaptive exam": "ابدأ اختباراً تكيفياً",
  "Sign in to your profile": "سجّل الدخول إلى ملفك",
  "The proposed model": "النموذج المقترح",
  "One engine, seven research subsystems": "محرك واحد وسبعة أنظمة بحثية",
  "The adaptive response pipeline": "مسار الاستجابة التكيفية",
  "Bloom-Integrated 2PL IRT": "نموذج IRT ثنائي المعامل مع بلوم",
  "Signed Time Strain": "ضغط الوقت المرجّح",
  "Visual Mismatch V": "عدم التطابق البصري V",
  "Information-Based Selection": "اختيار قائم على المعلومات",
  "Independent Integrity Engine": "محرك نزاهة مستقل",
  "Reproducible Research Log": "سجل بحثي قابل لإعادة الإنتاج",
  "Master's research · Bloom's Taxonomy-Integrated Adaptive IRT": "بحث ماجستير · تقييم تكيفي متكامل مع تصنيف بلوم",
  "Assessment that": "تقييم",
  "adapts to how you think": "يتكيف مع طريقة تفكيرك",
  "not just what you answer.": "وليس فقط إجابتك.",
  "A research-grade adaptive testing engine fusing 2-parameter IRT, six-dimensional Bloom ability profiles, signed time strain, and visual-mismatch modeling — with academic-integrity monitoring kept rigorously separate.": "محرك تقييم تكيفي بحثي يدمج نموذج IRT ثنائي المعامل، وملفات قدرات بلوم السداسية، وضغط الوقت المرجّح، ونمذجة عدم التطابق البصري — مع فصل مراقبة النزاهة الأكاديمية بدقة.",
  "Answer": "إجابة",
  "Time strain T": "ضغط الوقت T",
  "Visual mismatch V": "عدم التطابق البصري V",
  "Behavior case": "حالة السلوك",
  "Utility ranking": "ترتيب المنفعة",
  "Next item": "السؤال التالي",
  "Every answer flows through the full mathematical workflow — nothing is reduced to \"correct → harder\".": "تمر كل إجابة عبر سير العمل الرياضي الكامل — ولا يقتصر الأمر على \"صحيح ← أصعب\".",
  "Question updated": "تم تحديث السؤال",
  "Question added to the bank": "تمت إضافة السؤال إلى البنك",
  "Question saved": "تم حفظ السؤال",
  "Save failed": "فشل الحفظ",
  "Title is required": "العنوان مطلوب",
  "Correct answer is required": "الإجابة الصحيحة مطلوبة",
  "Question text is required": "نص السؤال مطلوب",
  "Choose the subject/category": "اختر المادة أو التصنيف",
  "Choose the question type": "اختر نوع السؤال",
  "Add at least 2 options": "أضف خيارين على الأقل",
  "Add at least 2 draggable items": "أضف عنصرين على الأقل للسحب",
  "Add at least 2 drop targets": "أضف هدفين على الأقل للإفلات",
  "Assign every draggable item to a target": "عيّن كل عنصر قابل للسحب إلى هدف",
  "Set a complete correct sequence for every item": "حدّد تسلسلاً صحيحاً كاملاً لكل عنصر",
  "Pick the correct answer from the options": "اختر الإجابة الصحيحة من الخيارات",
  "Multiple-choice questions need at least 2 options": "أسئلة الاختيار من متعدد تحتاج إلى خيارين على الأقل",
  "Question added to the shared bank": "تمت إضافة السؤال إلى البنك المشترك",
  "Private question added to your bank": "تمت إضافة سؤال خاص إلى بنكك",
  "Delete question?": "حذف السؤال؟",
  "Edit": "تعديل",
  "Share": "مشاركة",
  "Unshare": "إلغاء المشاركة",
  "Import": "استيراد",
  "Imported": "تم الاستيراد",
  "Already imported": "تم استيراده بالفعل",
  "Private question": "سؤال خاص",
  "Platform question": "سؤال المنصة",
  "Filter by subject": "تصفية حسب المادة",
  "Filter by creator": "تصفية حسب المنشئ",
  "All creators": "كل المنشئين",
  "All types": "كل الأنواع",
  "Created by": "أنشأه",
  "Last updated": "آخر تحديث",
  "View question": "عرض السؤال",
  "Close": "إغلاق",
  "Back": "رجوع",
  "Continue": "متابعة",
  "Finish": "إنهاء",
  "Finish assessment": "إنهاء التقييم",
  "Submit assessment": "إرسال التقييم",
  "Submit whenever you're ready.": "أرسل عندما تكون مستعداً.",
  "Your next question is ready.": "سؤالك التالي جاهز.",
  "The adaptive model has selected your next question.": "اختار النموذج التكيفي سؤالك التالي.",
  "That was the final question — you can submit now.": "كان هذا السؤال الأخير — يمكنك الإرسال الآن.",
  "Continue to submit": "المتابعة للإرسال",
  "All questions answered": "تمت الإجابة على كل الأسئلة",
  "All required Create questions correct — Passed – Grade A": "جميع أسئلة الإبداع المطلوبة صحيحة — ناجح – تقدير أ",
  "Create questions completed — assessment finished": "اكتملت أسئلة الإبداع — انتهى التقييم",
  "No more eligible questions — assessment finished": "لا توجد أسئلة مؤهلة أخرى — انتهى التقييم",
  "Verify your identity": "تحقق من هويتك",
  "Look at the camera — we compare your live face with your registered facial data before the assessment starts.": "انظر إلى الكاميرا — نقارن وجهك المباشر ببيانات وجهك المسجلة قبل بدء التقييم.",
  "Opening camera…": "جارٍ فتح الكاميرا...",
  "Verifying your identity…": "جارٍ التحقق من هويتك...",
  "Identity verified — starting…": "تم التحقق من الهوية — جارٍ البدء...",
  "Face registration required": "تسجيل الوجه مطلوب",
  "Go to face registration": "الانتقال إلى تسجيل الوجه",
  "Retry verification": "إعادة محاولة التحقق",
  "Back to my class": "العودة إلى صفي",
  "Sign in required": "تسجيل الدخول مطلوب",
  "Student access required": "صلاحية الطالب مطلوبة",
  "Instructor access required": "صلاحية المعلم مطلوبة",
  "Admin access required": "صلاحية الإدارة مطلوبة",
  "Not authenticated": "لم يتم تسجيل الدخول",
  "You must join this class before taking the assessment.": "يجب الانضمام إلى هذا الصف قبل بدء التقييم.",
  "This assessment is no longer open": "هذا التقييم لم يعد مفتوحاً",
  "This submission was already submitted": "تم إرسال هذه المحاولة بالفعل",
  "No question is currently served": "لا يوجد سؤال معروض حالياً",
  "Session is not active": "الجلسة غير نشطة",
  "Session not found": "الجلسة غير موجودة",
  "Not your session": "هذه الجلسة ليست لك",
  "Exam already complete": "الاختبار مكتمل بالفعل",
  "Please enter an answer before submitting.": "يرجى إدخال إجابة قبل الإرسال.",
  "Could not save answer": "تعذر حفظ الإجابة",
  "Answer already saved — continuing to your current question.": "تم حفظ الإجابة بالفعل — جارٍ المتابعة إلى سؤالك الحالي.",
  "Answer saved": "تم حفظ الإجابة",
  "Answer submitted": "تم إرسال الإجابة",
  "Your answer": "إجابتك",
  "Your response": "استجابتك",
  "Question not found": "السؤال غير موجود",
  "Class not found": "الصف غير موجود",
  "Assessment not found": "التقييم غير موجود",
  "Exam not found": "الاختبار غير موجود",
  "Student not found": "الطالب غير موجود",
  "Instructor not found": "المعلم غير موجود",
  "No student record linked to this account": "لا يوجد سجل طالب مرتبط بهذا الحساب",
  "No student record matches your email — ask your instructor to add you with this email.": "لا يوجد سجل طالب يطابق بريدك — اطلب من معلمك إضافتك بهذا البريد.",
  "Add your identity image before joining a class.": "أضف صورة هويتك قبل الانضمام إلى صف.",
  "Complete face registration before starting the assessment.": "أكمل تسجيل الوجه قبل بدء التقييم.",
  "This class is not open for joining": "هذا الصف غير مفتوح للانضمام",
  "This assessment opens on": "يفتح هذا التقييم في",
  "This class is closed — only the final exam is available.": "هذا الصف مغلق — الاختبار النهائي فقط متاح.",
  "You have already submitted this assessment": "لقد أرسلت هذا التقييم بالفعل",
  "This assessment has no questions yet": "لا توجد أسئلة في هذا التقييم بعد",
  "Class final": "الاختبار النهائي للصف",
  "Adaptive AI": "تكيفي بالذكاء الاصطناعي",
  "Adaptive": "تكيفي",
  "Static exam": "اختبار ثابت",
  "Random draw": "سحب عشوائي",
  "Fair Adaptive": "تكيفي عادل",
  "Pool": "المجموعة",
  "Marks": "العلامات",
  "Your answer is saved": "تم حفظ إجابتك",
  "Answer saved — you can continue": "تم حفظ الإجابة — يمكنك المتابعة",
  "Press Submit answer to continue": "اضغط إرسال الإجابة للمتابعة",
  "No answer selected": "لم يتم اختيار إجابة",
  "Choose an answer": "اختر إجابة",
  "Choose the best answer": "اختر الإجابة الأفضل",
  "Write your answer": "اكتب إجابتك",
  "Type your response": "اكتب استجابتك",
  "Enter your answer": "أدخل إجابتك",
  "Review": "مراجعة",
  "Review answers": "مراجعة الإجابات",
  "Back to exam": "العودة إلى الاختبار",
  "Return to dashboard": "العودة إلى لوحة التحكم",
  "Return to class": "العودة إلى الصف",
  "No results yet": "لا توجد نتائج بعد",
  "Results are not available yet": "النتائج غير متاحة بعد",
  "Report": "تقرير",
  "Certificate": "شهادة",
  "Generate report": "إنشاء تقرير",
  "Generate certificate": "إنشاء شهادة",
  "Certificate of completion": "شهادة إتمام",
  "This certifies that": "تشهد هذه الشهادة بأن",
  "has successfully completed": "قد أكمل بنجاح",
  "Date issued": "تاريخ الإصدار",
  "Date issued:": "تاريخ الإصدار:",
  "marks ·": "علامة ·",
  "Print / Save PDF": "طباعة / حفظ PDF",
  "Print report": "طباعة التقرير",
  "Export report": "تصدير التقرير",
  "Select language": "اختر اللغة",
  "Language": "اللغة",
  // Page headings, empty states, and shared form labels
  "All Bloom": "كل مستويات بلوم",
  "All categories": "كل التصنيفات",
  "All difficulties": "كل مستويات الصعوبة",
  "All question types": "كل أنواع الأسئلة",
  "All topics": "كل الموضوعات",
  "All subjects": "كل المواد",
  "All classes": "كل الصفوف",
  "All exam types": "كل أنواع الاختبارات",
  "All time": "كل الأوقات",
  "Any creator": "أي منشئ",
  "Assessment results": "نتائج التقييم",
  "Assessment result": "نتيجة التقييم",
  "Assessment management": "إدارة التقييمات",
  "Assessment history": "سجل التقييمات",
  "Overall assessment score": "الدرجة الإجمالية للتقييم",
  "Result": "النتيجة",
  "Page Not Found": "الصفحة غير موجودة",
  "Back to home": "العودة إلى الرئيسية",
  "Full name (optional)": "الاسم الكامل (اختياري)",
  "Min. 8 characters": "8 أحرف على الأقل",
  "Or continue with": "أو تابع باستخدام",
  "Privacy Policy": "سياسة الخصوصية",
  "Account security": "أمان الحساب",
  "Confirm new password": "تأكيد كلمة المرور الجديدة",
  "No email on this account": "لا يوجد بريد إلكتروني لهذا الحساب",
  "Close the class": "إغلاق الصف",
  "Create the final exam": "إنشاء الاختبار النهائي",
  "Open portal": "فتح البوابة",
  "Checked at": "وقت التحقق",
  "Last verification": "آخر تحقق",
  "My profile": "ملفي الشخصي",
  "Not yet": "ليس بعد",
  "Question review": "مراجعة الأسئلة",
  "Class performance report": "تقرير أداء الصف",
  "Student performance trend": "اتجاه أداء الطالب",
  "Average score by assessment": "متوسط الدرجة حسب التقييم",
  "Performance history (score % over time)": "سجل الأداء (النسبة عبر الوقت)",
  "Scores across assessments": "الدرجات عبر التقييمات",
  "No completed assessments yet.": "لا توجد تقييمات مكتملة بعد.",
  "No data yet.": "لا توجد بيانات بعد.",
  "No assessments yet.": "لا توجد تقييمات بعد.",
  "Institution not found.": "المؤسسة غير موجودة.",
  "Student not found.": "الطالب غير موجود.",
  "Instructor not found.": "المعلم غير موجود.",
  "No subject": "بدون مادة",
  "No adaptive": "لا يوجد تكيفي",
  "System information": "معلومات النظام",
  "Facility name": "اسم المرفق",
  "Government sector": "القطاع الحكومي",
  "Contact person": "الشخص المسؤول",
  "Department": "القسم",
  "Employees / students": "الموظفون / الطلاب",
  "Specialization": "التخصص",
  "Manager": "المدير",
  "Address": "العنوان",
  "City": "المدينة",
  "Contact": "جهة الاتصال",
  "Parent institution": "المؤسسة الأم",
  "Label": "التسمية",
  "Name": "الاسم",
  "Description (optional)": "الوصف (اختياري)",
  "Answer format": "صيغة الإجابة",
  "Multiple choice": "اختيار من متعدد",
  "Written answer": "إجابة مكتوبة",
  "True / False": "صح / خطأ",
  "Question types": "أنواع الأسئلة",
  "Subjects & categories": "المواد والتصنيفات",
  "New topic": "موضوع جديد",
  "The taxonomy is empty": "التصنيف فارغ",
  "Loading taxonomy…": "جارٍ تحميل التصنيف...",
  "Last 12 months": "آخر 12 شهراً",
  "Last 30 days": "آخر 30 يوماً",
  "Last 6 months": "آخر 6 أشهر",
  "Last 90 days": "آخر 90 يوماً",
  "Fair Final only": "التقييم النهائي العادل فقط",
  "Final attempts": "محاولات الاختبار النهائي",
  "Other assessments": "تقييمات أخرى",
  "Average time on paper": "متوسط الوقت في الاختبار",
  "Bloom level comparison": "مقارنة مستويات بلوم",
  "Bloom level": "مستوى بلوم",
  "Institution performance": "أداء المؤسسة",
  "Teaching center performance": "أداء مركز التعليم",
  "Government facility performance": "أداء المرفق الحكومي",
  "Overall system performance": "أداء النظام الإجمالي",
  "Facilities": "المرافق",
  "Center": "المركز",
  "Facility": "المرفق",
  "Personnel": "الموظفون",
  "Completions": "الإكمالات",
  "Avg score": "متوسط الدرجة",
  "Avg score %": "متوسط الدرجة %",
  "Avg %": "متوسط %",
  "Pass %": "نسبة النجاح %",
  "Attempts": "المحاولات",
  "Completed": "مكتمل",
  "Report title": "عنوان التقرير",
  "Generate performance reports with live data and export them": "أنشئ تقارير أداء ببيانات مباشرة وصدّرها",
  "Need demo data to explore reports? The seed creates a full institution hierarchy with real assessment sessions.": "هل تحتاج بيانات تجريبية لاستكشاف التقارير؟ ينشئ التهيئة تسلسلاً كاملاً للمؤسسات مع جلسات تقييم حقيقية.",
  "Seed demo org data": "تهيئة بيانات المؤسسات التجريبية",
  "Draggable items": "العناصر القابلة للسحب",
  "All items placed — tap an item inside a target to move it back.": "تم وضع كل العناصر — اضغط على عنصر داخل هدف لإعادته.",
  "Drop or tap to place here": "أفلت أو اضغط للوضع هنا",
  "Drag to reorder — top is first": "اسحب لإعادة الترتيب — الأعلى أولاً",
  "Every placement must be correct to earn this question's marks.": "يجب أن تكون كل عملية وضع صحيحة للحصول على علامات هذا السؤال.",
  "Each correct placement earns a proportional share of the marks.": "كل عملية وضع صحيحة تمنح جزءاً متناسباً من العلامات.",
  "Selecting your next question…": "جارٍ اختيار السؤال التالي...",
  "Session complete — preparing your report…": "اكتملت الجلسة — جارٍ إعداد تقريرك...",
  "Skip failed — please retry": "فشل التخطي — يرجى المحاولة مرة أخرى",
  "Not verified": "لم يتم التحقق",
  "Failed to start": "تعذر البدء",
  "Phone": "الهاتف",
  "COCO-SSD + face": "COCO-SSD + الوجه",
  "Camera could not be opened.": "تعذر فتح الكاميرا.",
  "Camera disconnected": "تم فصل الكاميرا",
  "Camera permission denied — allow camera access and retry.": "تم رفض إذن الكاميرا — اسمح بالوصول إلى الكاميرا ثم أعد المحاولة.",
  "Verification engine could not start — check your connection and retry.": "تعذر تشغيل محرك التحقق — تحقق من اتصالك ثم أعد المحاولة.",
  "Submit failed": "فشل الإرسال",
  "The adaptive model picks each question from the pool based on your responses.": "يختار النموذج التكيفي كل سؤال من المجموعة بناءً على إجاباتك.",
  "This is a fixed paper — the same questions in the same order for everyone.": "هذا اختبار ثابت — الأسئلة نفسها وبالترتيب نفسه للجميع.",
  "Your questions were drawn at random from the pool for each Bloom level.": "تم سحب أسئلتك عشوائياً من المجموعة لكل مستوى من مستويات بلوم.",
  "Not passed": "غير ناجح",
  "The whole sequence must be correct to earn this question's marks.": "يجب أن يكون التسلسل كاملاً صحيحاً للحصول على علامات هذا السؤال.",
  "Each item in the right position earns a proportional share of the marks.": "كل عنصر في موضعه الصحيح يمنح جزءاً متناسباً من العلامات.",
  // Additional server-side validation messages rendered by toasts.
  "Name cannot be empty": "لا يمكن أن يكون الاسم فارغاً",
  "Not submitted yet": "لم يتم الإرسال بعد",
  "Nothing to update": "لا يوجد ما يُحدّث",
  "Submission is still in progress": "لا يزال الإرسال قيد التقدم",
  "Submission not found": "الإرسال غير موجود",
  "The final exam has no questions yet.": "الاختبار النهائي لا يحتوي على أسئلة بعد.",
  "This assessment is not open": "هذا التقييم غير مفتوح",
  "Uploaded image not found": "الصورة المرفوعة غير موجودة",
  "Add your identity image before starting the assessment.": "أضف صورة هويتك قبل بدء التقييم.",
  "All displayed questions have been answered": "تمت الإجابة على جميع الأسئلة المعروضة",
  "Admins manage students from the admin console.": "يدير المسؤولون الطلاب من لوحة الإدارة.",
});

const AR_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Question (\d+) of (\d+)$/, (m) => `السؤال ${m[1]} من ${m[2]}`],
  [/^Question (\d+)$/, (m) => `السؤال ${m[1]}`],
  [/^(\d+) of (\d+)$/, (m) => `${m[1]} من ${m[2]}`],
  [/^(\d+) answered$/, (m) => `${m[1]} تمت الإجابة`],
  [/^(\d+)\/(\d+) answered$/, (m) => `${m[1]}/${m[2]} تمت الإجابة`],
  [/^(\d+) mark(?:s)?$/, (m) => `${m[1]} علامة`],
  [/^(\d+) students?$/, (m) => `${m[1]} طالب`],
  [/^(\d+) questions?$/, (m) => `${m[1]} سؤال`],
  [/^(\d+) attempts?$/, (m) => `${m[1]} محاولة`],
  [/^(\d+) violations?$/, (m) => `${m[1]} مخالفة`],
];

export function translateText(text: string, language: Language): string {
  if (language === "en") return text;
  const leading = text.match(/^\s*/)?.[0] ?? "";
  const trailing = text.match(/\s*$/)?.[0] ?? "";
  const core = text.trim().replace(/\s+/g, " ");
  if (!core) return text;
  const exact = translations.ar[core];
  if (exact) return `${leading}${exact}${trailing}`;
  for (const [re, fn] of AR_PATTERNS) {
    const m = core.match(re);
    if (m) return `${leading}${fn(m)}${trailing}`;
  }
  return text;
}

type I18nValue = {
  language: Language;
  dir: "ltr" | "rtl";
  isRtl: boolean;
  setLanguage: (language: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatNumber: (value: number) => string;
  formatDate: (value: number | Date, options?: Intl.DateTimeFormatOptions) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function initialLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "ar" ? "ar" : "en";
}

function applyDocumentLanguage(language: Language) {
  const root = document.documentElement;
  root.lang = language;
  root.dir = language === "ar" ? "rtl" : "ltr";
  root.dataset.language = language;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useLayoutEffect(() => {
    applyDocumentLanguage(language);
    window.localStorage.setItem(STORAGE_KEY, language);
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const template =
        language === "ar" ? translations.ar[key] ?? key : key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) =>
        String(vars[name] ?? `{${name}}`),
      );
    },
    [language],
  );

  const formatNumber = useCallback(
    (value: number) =>
      new Intl.NumberFormat(language === "ar" ? "ar-EG" : "en-US").format(value),
    [language],
  );

  const formatDate = useCallback(
    (value: number | Date, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(
        language === "ar" ? "ar-EG" : "en-US",
        options ?? { dateStyle: "medium", timeStyle: "short" },
      ).format(value),
    [language],
  );

  const value = useMemo<I18nValue>(
    () => ({
      language,
      dir: language === "ar" ? "rtl" : "ltr",
      isRtl: language === "ar",
      setLanguage,
      t,
      formatNumber,
      formatDate,
    }),
    [language, setLanguage, t, formatNumber, formatDate],
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
      <GlobalTextTranslator language={language} />
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "CODE",
  "PRE",
  "SVG",
  "PATH",
]);

type TextRecord = { original: string; translated: string };

/**
 * The existing app predates i18n and contains thousands of literal labels.
 * This layer applies the same centralized dictionary to already-rendered
 * React text and attributes, so every current page participates immediately
 * while new code can call useI18n().t() directly. It skips inputs, code, and
 * any element marked data-no-translate.
 */
function GlobalTextTranslator({ language }: { language: Language }) {
  const recordsRef = useRef(new WeakMap<Text, TextRecord>());
  const attributesRef = useRef(
    new WeakMap<Element, Map<string, { original: string; translated: string }>>(),
  );

  useEffect(() => {
    const records = recordsRef.current;
    const attributeRecords = attributesRef.current;
    let applying = false;

    const skip = (node: Node): boolean => {
      let el: Element | null =
        node.nodeType === Node.ELEMENT_NODE
          ? (node as Element)
          : node.parentElement;
      while (el) {
        if (SKIP_TAGS.has(el.tagName)) return true;
        if (el.hasAttribute("data-no-translate")) return true;
        if (el.getAttribute("contenteditable") === "true") return true;
        el = el.parentElement;
      }
      return false;
    };

    const translateNode = (node: Text) => {
      if (skip(node)) return;
      const current = node.nodeValue ?? "";
      let rec = records.get(node);
      if (rec && current === rec.translated) return;
      if (!rec || current !== rec.original) {
        rec = { original: current, translated: current };
        records.set(node, rec);
      }
      const translated = translateText(rec.original, language);
      if (translated !== current) {
        applying = true;
        node.nodeValue = translated;
        applying = false;
      } else if (rec.translated !== current) {
        applying = true;
        node.nodeValue = rec.translated;
        applying = false;
      }
    };

    const translateAttributes = (el: Element) => {
      if (skip(el)) return;
      const attrs = ["placeholder", "title", "aria-label", "alt"];
      let map = attributeRecords.get(el);
      if (!map) {
        map = new Map();
        attributeRecords.set(el, map);
      }
      for (const attr of attrs) {
        const current = el.getAttribute(attr);
        if (current === null) continue;
        let rec = map.get(attr);
        if (!rec || (current !== rec.original && current !== rec.translated)) {
          rec = { original: current, translated: current };
          map.set(attr, rec);
        }
        const translated = translateText(rec.original, language);
        if (translated !== current) {
          applying = true;
          el.setAttribute(attr, translated);
          applying = false;
        } else if (rec.translated !== current) {
          applying = true;
          el.setAttribute(attr, rec.translated);
          applying = false;
        }
      }
    };

    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        translateNode(root as Text);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE)
        return;
      if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root as Element);
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      );
      let node = walker.nextNode();
      while (node) {
        if (node.nodeType === Node.TEXT_NODE) translateNode(node as Text);
        else translateAttributes(node as Element);
        node = walker.nextNode();
      }
    };

    const applyAll = () => {
      walk(document.body);
    };

    applyAll();

    const observer = new MutationObserver((mutations) => {
      if (applying) return;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          translateNode(mutation.target as Text);
        } else if (mutation.type === "attributes") {
          translateAttributes(mutation.target as Element);
        } else {
          mutation.addedNodes.forEach((node) => walk(node));
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label", "alt"],
    });

    return () => observer.disconnect();
  }, [language]);

  return null;
}
