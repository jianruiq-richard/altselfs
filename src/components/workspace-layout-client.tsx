'use client';

import { AstromarWorkspaceShell } from '@/components/astromar-workspace-shell';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

type WorkspaceChrome = {
  owner: string;
  mobileTitle?: string;
  onNewDiscussion?: () => void;
  newDiscussionBusy?: boolean;
  newDiscussionDisabled?: boolean;
};

type WorkspaceLayoutContextValue = {
  setChrome: React.Dispatch<React.SetStateAction<WorkspaceChrome | null>>;
  sidebarTargets: {
    desktop: HTMLElement | null;
    mobile: HTMLElement | null;
  };
  rightRailTarget: HTMLElement | null;
};

type WorkspacePageChromeOptions = Omit<WorkspaceChrome, 'owner'>;

const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextValue | null>(null);
const SIDEBAR_SLOT_ID = 'astromar-workspace-sidebar-slot';
const RIGHT_RAIL_SLOT_ID = 'astromar-workspace-right-rail-slot';
const NAVIGATION_START_EVENT = 'astromar:workspace-navigation-start';

function defaultMobileTitle(pathname: string) {
  if (pathname.startsWith('/investor/chat')) return 'Discussion';
  if (pathname.startsWith('/connectors')) return 'Connectors';
  if (pathname.startsWith('/profile')) return 'Settings';
  return 'Workspace';
}

function routeHasRightRail(pathname: string) {
  return pathname.startsWith('/investor/chat');
}

function WorkspaceNavigationObserver() {
  const pathname = usePathname();
  const navigationRef = useRef<{
    startPath: string;
    destination: string;
    startedAt: number;
  } | null>(null);
  const [visible, setVisible] = useState(false);
  const showTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearTimers = () => {
      if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
      if (safetyTimerRef.current !== null) window.clearTimeout(safetyTimerRef.current);
      showTimerRef.current = null;
      safetyTimerRef.current = null;
    };
    const beginNavigation = (destination: string) => {
      clearTimers();
      navigationRef.current = {
        startPath: window.location.pathname,
        destination,
        startedAt: performance.now(),
      };
      performance.mark('astromar-workspace-navigation-start');
      setVisible(false);
      showTimerRef.current = window.setTimeout(() => setVisible(true), 100);
      safetyTimerRef.current = window.setTimeout(() => {
        navigationRef.current = null;
        setVisible(false);
      }, 15_000);
    };

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (`${destination.pathname}${destination.search}${destination.hash}` === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
      beginNavigation(`${destination.pathname}${destination.search}${destination.hash}`);
    };

    const handleProgrammaticNavigation = (event: Event) => {
      const destination = event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : '';
      if (destination) beginNavigation(destination);
    };

    document.addEventListener('click', handleClick, true);
    window.addEventListener(NAVIGATION_START_EVENT, handleProgrammaticNavigation);
    return () => {
      clearTimers();
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener(NAVIGATION_START_EVENT, handleProgrammaticNavigation);
    };
  }, []);

  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation || pathname === navigation.startPath) return;

    const duration = performance.now() - navigation.startedAt;
    performance.mark('astromar-workspace-navigation-shell');
    performance.measure(
      'astromar-workspace-click-to-shell',
      'astromar-workspace-navigation-start',
      'astromar-workspace-navigation-shell',
    );
    window.dispatchEvent(new CustomEvent('astromar:workspace-navigation-measured', {
      detail: {
        destination: navigation.destination,
        duration,
      },
    }));
    navigationRef.current = null;
    if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    if (safetyTimerRef.current !== null) window.clearTimeout(safetyTimerRef.current);
    showTimerRef.current = null;
    safetyTimerRef.current = null;
    window.setTimeout(() => setVisible(false), 0);
  }, [pathname]);

  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-white/10" aria-hidden="true">
      <span className="block h-full w-2/3 animate-pulse bg-[#8eb3ff] shadow-[0_0_14px_rgba(142,179,255,.8)]" />
    </div>
  );
}

export function startWorkspaceNavigation(destination: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NAVIGATION_START_EVENT, { detail: destination }));
}

export function WorkspaceLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [chrome, setChrome] = useState<WorkspaceChrome | null>(null);
  const [sidebarTargets, setSidebarTargets] = useState<WorkspaceLayoutContextValue['sidebarTargets']>({
    desktop: null,
    mobile: null,
  });
  const [rightRailTarget, setRightRailTarget] = useState<HTMLElement | null>(null);
  const setDesktopSidebarTarget = useCallback((target: HTMLElement | null) => {
    setSidebarTargets((current) => current.desktop === target ? current : {
      ...current,
      desktop: target,
    });
  }, []);
  const setMobileSidebarTarget = useCallback((target: HTMLElement | null) => {
    setSidebarTargets((current) => current.mobile === target ? current : {
      ...current,
      mobile: target,
    });
  }, []);
  const contextValue = useMemo(
    () => ({ setChrome, sidebarTargets, rightRailTarget }),
    [rightRailTarget, sidebarTargets],
  );
  const showRightRail = routeHasRightRail(pathname);

  return (
    <WorkspaceLayoutContext.Provider value={contextValue}>
      <WorkspaceNavigationObserver />
      <AstromarWorkspaceShell
        mobileTitle={chrome?.mobileTitle || defaultMobileTitle(pathname)}
        sidebarContent={(location) => (
          <div
            ref={location === 'desktop' ? setDesktopSidebarTarget : setMobileSidebarTarget}
            id={`${SIDEBAR_SLOT_ID}-${location}`}
            className="h-full min-h-0"
          />
        )}
        rightRail={showRightRail ? <div ref={setRightRailTarget} id={RIGHT_RAIL_SLOT_ID} className="h-full min-h-0" /> : undefined}
        onNewDiscussion={chrome?.onNewDiscussion}
        newDiscussionBusy={chrome?.newDiscussionBusy}
        newDiscussionDisabled={chrome?.newDiscussionDisabled}
      >
        {children}
      </AstromarWorkspaceShell>
    </WorkspaceLayoutContext.Provider>
  );
}

export function useWorkspacePageChrome(options: WorkspacePageChromeOptions) {
  const context = useContext(WorkspaceLayoutContext);
  const setChrome = context?.setChrome;
  const owner = useId();
  const {
    mobileTitle,
    onNewDiscussion,
    newDiscussionBusy = false,
    newDiscussionDisabled = false,
  } = options;

  useLayoutEffect(() => {
    if (!setChrome) return;
    setChrome({
      owner,
      mobileTitle,
      onNewDiscussion,
      newDiscussionBusy,
      newDiscussionDisabled,
    });
    return () => {
      setChrome((current) => current?.owner === owner ? null : current);
    };
  }, [
    setChrome,
    mobileTitle,
    newDiscussionBusy,
    newDiscussionDisabled,
    onNewDiscussion,
    owner,
  ]);
}

export function useHasSharedWorkspaceLayout() {
  return useContext(WorkspaceLayoutContext) !== null;
}

export function WorkspaceSidebarSlot({ children }: { children: React.ReactNode }) {
  const context = useContext(WorkspaceLayoutContext);
  if (!context) return null;
  return (
    <>
      {context.sidebarTargets.desktop
        ? createPortal(children, context.sidebarTargets.desktop, 'workspace-sidebar-desktop')
        : null}
      {context.sidebarTargets.mobile
        ? createPortal(children, context.sidebarTargets.mobile, 'workspace-sidebar-mobile')
        : null}
    </>
  );
}

export function WorkspaceRightRailSlot({ children }: { children: React.ReactNode }) {
  const context = useContext(WorkspaceLayoutContext);
  return context?.rightRailTarget ? createPortal(children, context.rightRailTarget) : null;
}
