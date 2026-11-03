import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  IconBell,
  IconBookmark,
  IconStar,
  IconCalendarEvent,
  IconInfoCircle,
  IconListDetails,
  IconLogin,
  IconLogout,
  IconMenu2,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import { isDesignatedVisitApproverEmail } from '../../../shared/visitApprover'
import { supabase } from '../../lib/supabase'
import { useWatches } from '../catalog/useWatches'
import { displayNameOf, useSession } from './useSession'

const INFO_URL = 'https://www.uta.edu/student-affairs/health-and-wellness/maverick-pantry'
const BOOK_URL = 'https://app.pantrysoft.com/login/maverickpantry'

export function Navbar() {
  const session = useSession()
  const reviewer = isDesignatedVisitApproverEmail(session?.user.email)
  const [open, setOpen] = useState(false)
  const { data: watches } = useWatches(!!session && !reviewer)
  const changed = watches?.filter((w) => w.changed).length ?? 0
  const changedBadge = changed > 0 && <span className="badge badge-info badge-sm">{changed}</span>
  const close = () => setOpen(false)

  return (
    <div className="drawer drawer-end">
      <input
        id="nav-drawer"
        type="checkbox"
        className="drawer-toggle"
        checked={open}
        onChange={(e) => setOpen(e.target.checked)}
      />

      <div className="drawer-content">
        <nav className="navbar border-b border-base-300 bg-base-100 px-4">
          <Link to="/" className="flex-1 text-lg font-semibold">Thyme Saver</Link>

          <div className="hidden sm:flex">
            <a href={INFO_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm mr-2">
              Info
            </a>
            <a href={BOOK_URL} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm mr-2">
              Book Appointment
            </a>
          </div>

          <label
            htmlFor="nav-drawer"
            className="btn btn-ghost btn-square sm:hidden"
            aria-label="Open menu"
          >
            <IconMenu2 size={28} />
          </label>

          {session === undefined ? null : session ? (
            <div className="dropdown dropdown-end hidden sm:block">
              <button tabIndex={0} className="btn btn-ghost btn-sm">
                <IconUser size={18} /> {displayNameOf(session)}
              </button>
              <ul tabIndex={0} className="menu dropdown-content z-10 mt-2 w-44 rounded-box bg-base-100 p-2 shadow">
                {reviewer && <li><Link to="/visit-review"><IconCalendarEvent size={18} /> Review visit requests</Link></li>}
                {!reviewer && <li><Link to="/points"><IconStar size={18} /> Points</Link></li>}
                {!reviewer && <>
                <li><Link to="/profile"><IconBookmark size={18} /> Saved products</Link></li>
                <li><Link to="/watching"><IconBell size={18} /> Watching {changedBadge}</Link></li>
                <li><Link to="/queue"><IconListDetails size={18} /> My scans</Link></li>
                </>}
                <li>
                  <button onClick={() => void supabase.auth.signOut()}>
                    <IconLogout size={18} /> Sign out
                  </button>
                </li>
              </ul>
            </div>
          ) : (
            <Link to="/login" className="btn btn-primary btn-sm hidden sm:inline-flex">Sign in</Link>
          )}
        </nav>
      </div>

      <div className="drawer-side z-50 sm:hidden">
        <label htmlFor="nav-drawer" aria-label="Close menu" className="drawer-overlay" />
        <div className="flex min-h-full w-4/5 max-w-xs flex-col bg-base-100">
          <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
            <span className="text-lg font-semibold">Thyme Saver</span>
            <button className="btn btn-ghost btn-square" onClick={close} aria-label="Close menu">
              <IconX size={26} />
            </button>
          </div>

          {session && (
            <div className="flex items-center gap-3 border-b border-base-300 px-4 py-4">
              <IconUser size={24} />
              <span className="truncate text-base font-medium">{displayNameOf(session)}</span>
            </div>
          )}

          <ul className="menu menu-lg w-full flex-1 gap-1 p-3 text-base">
            <li>
              <a href={INFO_URL} target="_blank" rel="noopener noreferrer" onClick={close}>
                <IconInfoCircle size={22} /> Info
              </a>
            </li>
            <li>
              <a href={BOOK_URL} target="_blank" rel="noopener noreferrer" onClick={close}>
                <IconCalendarEvent size={22} /> Book Appointment
              </a>
            </li>
            {session && <li><Link to={reviewer ? "/visit-review" : "/points"} onClick={close}><IconStar size={22} /> {reviewer ? "Review visit requests" : "Points"}</Link></li>}
            {session && !reviewer && <li><Link to="/profile" onClick={close}><IconBookmark size={22} /> Saved products</Link></li>}
            {session && !reviewer && (
              <li>
                <Link to="/watching" onClick={close}>
                  <IconBell size={22} /> Watching {changedBadge}
                </Link>
              </li>
            )}
            {session && !reviewer && (
              <li>
                <Link to="/queue" onClick={close}>
                  <IconListDetails size={22} /> My scans
                </Link>
              </li>
            )}
          </ul>

          <div className="border-t border-base-300 p-3">
            {session ? (
              <button
                className="btn btn-outline btn-block"
                onClick={() => {
                  close()
                  void supabase.auth.signOut()
                }}
              >
                <IconLogout size={20} /> Sign out
              </button>
            ) : session === null ? (
              <Link to="/login" className="btn btn-primary btn-block" onClick={close}>
                <IconLogin size={20} /> Sign in
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
