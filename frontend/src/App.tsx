import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Upload, ListTodo, BookOpen, Settings as SettingsIcon, ScrollText, Languages } from 'lucide-react'
import Home from '@/pages/Home'
import Tasks from '@/pages/Tasks'
import TaskDetail from '@/pages/TaskDetail'
import Glossaries from '@/pages/Glossaries'
import Logs from '@/pages/Logs'
import Gallery from '@/pages/Gallery'
import Settings from '@/pages/Settings'
function Nav() {
  const links = [
    { to: '/', icon: Upload, label: '上传', end: true },
    { to: '/tasks', icon: ListTodo, label: '任务', end: false },
    { to: '/glossaries', icon: BookOpen, label: '术语库', end: false },
    { to: '/logs', icon: ScrollText, label: '日志', end: false },
    { to: '/settings', icon: SettingsIcon, label: '配置', end: false },
  ]
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <NavLink to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
            <Languages className="h-4 w-4" />
          </div>
          <span className="text-base font-bold bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
            MangaTrans
          </span>
        </NavLink>
        <nav className="flex gap-1">
          {links.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <Nav />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/tasks/:id" element={<TaskDetail />} />
            <Route path="/glossaries" element={<Glossaries />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
