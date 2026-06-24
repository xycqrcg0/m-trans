import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Upload, ListTodo, BookOpen, Settings as SettingsIcon } from 'lucide-react'
import Home from '@/pages/Home'
import Tasks from '@/pages/Tasks'
import TaskDetail from '@/pages/TaskDetail'
import Gallery from '@/pages/Gallery'
import Settings from '@/pages/Settings'
function Nav() {
  const links = [
    { to: '/', icon: Upload, label: '上传', end: true },
    { to: '/tasks', icon: ListTodo, label: '任务', end: false },
    { to: '/glossaries', icon: BookOpen, label: '术语库', end: false },
    { to: '/settings', icon: SettingsIcon, label: '配置', end: false },
  ]
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <span className="text-base font-bold text-slate-900">MangaTrans</span>
        <nav className="flex gap-1">
          {links.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
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
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
