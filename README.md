# website

Hey, Welcome to Qixuan's Personal site.


# My thoughts
有点问题，回头改一下

为啥没回车啊

Qixuan System
│
├── Frontend（前端网站）
│   │
│   ├── qixuan.net（主站 / 展示）
│   │   ├── /Home（展示型首页）
│   │   ├── /Projects（项目）
│   │   ├── /Files（文件）
│   │   ├── /Notes（笔记）
│   │   └── /About（关于）
│   │
│   └── home.qixuan.net（控制面板 / Dashboard）
│       ├── /Stats（统计）
│       ├── /MC Server（服务器状态）
│       ├── /Latest Project（最新项目）
│       ├── /Quick Links（快速入口）
│       ├── /GitHub Activity
│       ├── /Calendar / School
│       └── /System Status
│
├── Backend（API）
│   │
│   └── api.qixuan.net（Cloudflare Worker）
│       ├── /stats
│       ├── /projects
│       ├── /files
│       ├── /notes
│       ├── /about
│       ├── /contact
│       ├── /mc (服务器) http://map.qixuan.net （Map）https://mc.qixuan.net (Server)
│       ├── /github
│       └── /system
│
├── Storage（数据存储）
│   │
│   ├── Worker 内置 DB（小数据）
│   │   ├── about
│   │   ├── contact
│   │   ├── stats
│   │   └── projects
│   │
│   ├── Cloudflare KV（文本）
│   │   └── notes
│   │
│   ├── Cloudflare R2（文件）
│   │   └── files
│   │
│   └── D1 / SQLite（以后）
│       ├── users
│       ├── logs
│       ├── analytics
│       └── mc data
│
├── External Services（外部系统）
│   │
│   ├── Minecraft Server → /mc API
│   ├── GitHub → /github API
│   ├── Google Calendar → /calendar API
│   ├── School → /school API
│   └── Drone / FPV Logs → /fpv API
│
└── Future（以后可以加）
    ├── Login System
    ├── Admin Panel
    ├── Upload Files
    ├── Write Notes Online
    ├── Analytics
    └── Mobile App
