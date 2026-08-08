PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  student_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'reviewer', 'admin')),
  role_locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sections (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  section_slug TEXT NOT NULL REFERENCES sections(slug),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body_json TEXT NOT NULL,
  content_type TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  author_label TEXT NOT NULL DEFAULT '匿名同学',
  source_submission_id INTEGER,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL REFERENCES users(student_id),
  section_slug TEXT NOT NULL REFERENCES sections(slug),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body_json TEXT NOT NULL,
  content_type TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  author_label TEXT NOT NULL DEFAULT '匿名同学',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'changes_requested', 'approved', 'rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS review_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  reviewer_id TEXT NOT NULL REFERENCES users(student_id),
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_articles_section ON articles(section_slug, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id, created_at DESC);

INSERT OR IGNORE INTO sections (slug, title, description, icon, sort_order) VALUES
  ('start', '初来校园', '入学适应、住宿通勤与那些没人提前告诉你的事', '🌱', 10),
  ('courses', '课程与老师', '来自真实课堂的体验、方法与多元评价', '📚', 20),
  ('clubs', '社团与活动', '参与者视角下的氛围、投入和收获', '🎭', 30),
  ('years', '高中三年', '选科、分班、竞赛与每个阶段的经验', '🧭', 40),
  ('gaokao', '高三备考', '复习节奏、心态调整与走过弯路后的建议', '⏳', 50),
  ('life', '校园生活', '食堂、运动、朋友关系与日常生活', '🏫', 60),
  ('voices', '访谈与故事', '记录不同同学、老师和校友的真实经历', '🎙️', 70);

INSERT OR IGNORE INTO articles (slug, section_slug, title, summary, body_json, content_type, subject, author_label) VALUES
  ('welcome', 'start', '欢迎来到这本由同学共同写成的校园手册', '这里不提供唯一答案，只保存具体经历、真实感受和可供参考的选择。', '[{"type":"heading","text":"写在开始"},{"type":"paragraph","text":"校园生活很难被一份官方介绍概括。我们更想记录亲历者怎样做选择、遇到过什么，以及回头看时会给后来者什么建议。"},{"type":"quote","text":"经验不是标准答案。请结合时间、情境和自己的判断阅读。"},{"type":"heading","text":"你也可以参与"},{"type":"paragraph","text":"输入由四位年份、三位班级号和两位序号组成的九位学号登入，选择一个分区，像写在线文档一样完成投稿。审核者会给出反馈，通过后内容会出现在目录中。"}]', '说明', '本站', '编写组'),
  ('how-to-interview', 'voices', '怎样写一篇有信息量的校园访谈', '从具体场景和真实选择出发，少一些标签，多一些追问。', '[{"type":"paragraph","text":"好的访谈不急着为一个人或一个组织下结论，而是让读者看见具体经历。"},{"type":"heading","text":"建议追问"},{"type":"bullet","text":"当时有哪些选择？为什么最后这样决定？"},{"type":"bullet","text":"实际体验和原先预期有什么不同？"},{"type":"bullet","text":"投入了多少时间，最大的收获与代价分别是什么？"},{"type":"bullet","text":"如果重新来一次，会改变什么？"},{"type":"quote","text":"涉及老师和同学时，请描述可核实的事实，避免披露隐私或使用侮辱性表达。"}]', '投稿指南', '访谈', '编写组');

UPDATE sections SET title='初来潞园', description='入学适应、空间认识与那些没人提前告诉你的事', icon='门' WHERE slug='start';
UPDATE sections SET title='课程与课堂', description='具体到学科、教师、方法和场景的课堂经验', icon='课' WHERE slug='courses';
UPDATE sections SET title='社团与活动', description='参与者视角下的氛围、时间投入和真实收获', icon='社' WHERE slug='clubs';
UPDATE sections SET title='高中三年', description='选科、分班、竞赛与每个阶段的经验坐标', icon='年' WHERE slug='years';
UPDATE sections SET title='高三备考', description='复习节奏、心态调整与走过弯路后的复盘', icon='考' WHERE slug='gaokao';
UPDATE sections SET title='潞园生活', description='食堂、住宿、运动、人际关系与日常生活', icon='园' WHERE slug='life';
UPDATE sections SET title='访谈与故事', description='记录同学、教师与校友的具体选择和真实经历', icon='谈' WHERE slug='voices';
UPDATE articles SET title='欢迎来到 LHwiki', summary='这里不提供唯一答案，只保存具体经历、真实感受和可供参考的选择。', subject='LHwiki' WHERE slug='welcome';
UPDATE articles SET body_json=REPLACE(body_json, '使用 2026 开头的九位学号登入', '输入由四位年份、三位班级号和两位序号组成的九位学号登入') WHERE slug='welcome';

INSERT OR IGNORE INTO articles (slug, section_slug, title, summary, body_json, content_type, subject, author_label) VALUES
  ('lhwiki-start-here', 'start', '第一次打开 LHwiki，可以先读这一页', '这不是另一份学校简介，而是一份等待每届同学继续补写的经验地图。', '[{"type":"paragraph","text":"学校官网适合查准确的通知、制度和学校概况；LHwiki 想保存另一种信息：一件事实际要花多少时间，一门课怎样准备，一个选择可能带来什么，以及亲历者后来如何看待它。"},{"type":"heading","text":"读的时候保留判断"},{"type":"paragraph","text":"每篇文章都受时间、班级、课程安排和作者立场影响。读到鲜明结论时，先看看作者写的是哪一年、什么场景，再寻找第二种经验。"},{"type":"heading","text":"写的时候留下坐标"},{"type":"bullet","text":"说明大致时间、年级和具体场景。"},{"type":"bullet","text":"把观察到的事实与自己的感受分开。"},{"type":"bullet","text":"写清楚这段经验对什么样的读者可能有用。"},{"type":"quote","text":"真诚不是想到什么就说什么，而是愿意让读者知道你的结论从哪里来。"}]', '说明', 'LHwiki', '编辑组'),
  ('luhe-campus-context', 'start', '先认识脚下的潞园：一座仍在使用的百年校园', '从 1867 年到今天，老建筑、道路和新的学习空间共同构成了日常生活的背景。', '[{"type":"paragraph","text":"潞河中学创办于 1867 年。公开资料显示，校园占地约 17 万平方米，一个多世纪前的建筑与格局仍有保留，老建筑与教学楼、实验楼、体育馆、图书馆和宿舍等空间并置。"},{"type":"paragraph","text":"对新生来说，校史不必只是一串年份。你每天经过的道路、楼宇和树木，都可能连接着校友、学科传统或城市记忆。真正熟悉校园，往往从知道一栋楼为什么这样命名开始。"},{"type":"heading","text":"建议怎样补写"},{"type":"bullet","text":"记录从校门到教室的实际路线和容易走错的节点。"},{"type":"bullet","text":"写下一处你愿意停留的空间，以及它在一天中不同时间的样子。"},{"type":"bullet","text":"涉及开放时间和管理规定时，请以学校最新通知为准。"},{"type":"quote","text":"资料来源：潞河中学官网、北京市人民政府首都之窗公开介绍。整理日期为 2026 年 8 月。"}]', '资料整理', '校园', '编辑组'),
  ('luhe-course-map', 'courses', '读懂潞河课程地图：三个层面与十六类课程', '先看清课程体系的轮廓，再等待亲历者补上选择成本、课堂节奏和适合人群。', '[{"type":"paragraph","text":"学校公开资料将课程分为基础、拓展、提高三个层面，并列出学科基础、成长指导、德育活动、综合实践、人文拓展、科学拓展、技术操作、艺术、体育、社团、文化补充、国际交流体验、资优生实验、艺体特长、1+3 贯通培养、创新人才培养等十六类。"},{"type":"heading","text":"官网能告诉你的"},{"type":"paragraph","text":"课程目标、项目设置和制度框架，应优先查看学校当年的官方文件。"},{"type":"heading","text":"LHwiki 还需要回答的"},{"type":"bullet","text":"一周实际需要投入多少课内外时间？"},{"type":"bullet","text":"课堂更看重阅读、讨论、实验，还是阶段性成果？"},{"type":"bullet","text":"什么样的学生可能喜欢，什么情况下容易感到不适应？"},{"type":"bullet","text":"如果重新选择，亲历者会保留什么、改变什么？"},{"type":"quote","text":"这是一张资料地图，不是选课建议。具体课程以当学年安排为准。"}]', '资料整理', '课程体系', '编辑组'),
  ('teacher-review-principles', 'courses', '怎样匿名写一篇对老师真正有帮助的评价', '不做星级榜，不给人贴标签；把课堂的具体场景、自己的需求和实际影响写清楚。', '[{"type":"paragraph","text":"同一位老师面对不同班级、不同年份和不同学习基础，可能产生完全不同的体验。LHwiki 因此不设置星级和总分，而是并列呈现经审核的具体经历。"},{"type":"heading","text":"建议写进文章的四件事"},{"type":"number","text":"你在哪个年级、什么类型的课堂中与老师接触，大致是哪一学年。"},{"type":"number","text":"课堂节奏、作业反馈、提问方式或复习组织中，你实际观察到了什么。"},{"type":"number","text":"你的学习基础和需求是什么，这些做法对你产生了什么影响。"},{"type":"number","text":"你会给后来者什么可执行的相处或学习建议。"},{"type":"heading","text":"不会公开的内容"},{"type":"paragraph","text":"联系方式、家庭信息、健康情况、未经证实的严重指控、侮辱或针对外貌与私人生活的讨论，都不属于教学经验。涉及争议时，审核者会要求补充场景、删除可识别隐私，或拒绝发布。"}]', '投稿指南', '教师评价', '编辑组'),
  ('luyuan-literature-club', 'clubs', '从“潞园”文学社看社团：活动、课程与作品如何连起来', '官网资料提供了社团结构；真正的时间投入与成员体验，还需要当届同学补写。', '[{"type":"paragraph","text":"学校公开教学成果资料将“潞园”文学社的活动概括为四部分：社团活动课程化、采风与文学创作、人物访谈、与其他学校文学社交流。校刊也被视为学生实践的平台。"},{"type":"heading","text":"加入前可以问什么"},{"type":"bullet","text":"一学期有多少固定活动，最忙通常在什么时候？"},{"type":"bullet","text":"新成员会从什么任务开始，作品如何得到反馈？"},{"type":"bullet","text":"课程、社团和校刊之间的关系，在当届实际怎样运行？"},{"type":"bullet","text":"如果只是喜欢阅读但不擅长公开表达，是否仍有合适的位置？"},{"type":"quote","text":"以上结构来自学校公开资料，活动安排可能变化。欢迎现任或往届成员用亲历经验更新。"}]', '资料整理', '潞园文学社', '编辑组'),
  ('gaokao-review-template', 'gaokao', '高三经验不要只写“坚持”：一份可补写的复盘提纲', '把节奏、选择和弯路拆开，后来者才可能判断这份经验是否适合自己。', '[{"type":"paragraph","text":"备考文章最容易写成口号，也最容易让读者误以为某一种方法适合所有人。比起笼统地说努力，更有价值的是交代当时的问题、采取的办法、持续时间和结果。"},{"type":"heading","text":"可以按这条时间线写"},{"type":"bullet","text":"进入高三时：优势科目、最担心的问题和最初计划。"},{"type":"bullet","text":"一轮复习中：怎样跟住课堂，错题与练习如何取舍。"},{"type":"bullet","text":"阶段波动时：什么做法没有奏效，后来为何调整。"},{"type":"bullet","text":"临近考试时：睡眠、节奏、交流和信息筛选。"},{"type":"quote","text":"这篇只是共建提纲，不是备考方案。身体或情绪长期不适时，应优先向家长、教师和专业人员求助。"}]', '共建提纲', '高三复盘', '编辑组'),
  ('campus-life-observation', 'life', '把校园日常写得有用：从“一天”而不是“印象”开始', '食堂、住宿、运动和自习的经验，最好具体到时间、位置、频率与变化。', '[{"type":"paragraph","text":"校园生活的评价常常只有“方便”“拥挤”“很好”几个词，但后来者真正想知道的是：什么时候最拥挤，替代选择在哪里，一周会遇到几次，以及规则是否在不同学期发生变化。"},{"type":"heading","text":"一个简单写法"},{"type":"paragraph","text":"选择一个普通工作日，从到校、上课、午间、活动、自习写到离校或就寝。每到一个节点，记录你做了什么选择、为什么这样选，以及最希望新生提前知道什么。"},{"type":"heading","text":"保持信息新鲜"},{"type":"paragraph","text":"食堂窗口、开放时间、宿舍与校园管理规则可能变化。投稿时请标明学年；涉及明确规定时附上最新官方通知线索。"}]', '共建提纲', '校园日常', '编辑组');
