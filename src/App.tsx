import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Compass,
  Film,
  Home,
  LogIn,
  Megaphone,
  MessageCircle,
  Plus,
  Settings,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { AuthView } from './components/AuthView.tsx';
import { Avatar, RoleAndVerifiedBadge } from './components/Avatar.tsx';
import { ChatView } from './components/ChatView.tsx';
import { CreateStudioModal } from './components/CreateStudioModal.tsx';
import { ExploreView } from './components/ExploreView.tsx';
import { HomeFeed } from './components/HomeFeed.tsx';
import { NotificationsView } from './components/NotificationsView.tsx';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton.tsx';
import { ProfileView } from './components/ProfileView.tsx';
import { RatingScreen } from './components/RatingScreen.tsx';
import { ReelsFeed } from './components/ReelsFeed.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { ShareToChatModal } from './components/ShareToChatModal.tsx';
import { StoryViewerModal } from './components/StoryViewerModal.tsx';
import {
  apiFetch,
  cacheFeedOffline,
  getActiveToken,
  readOfflineFeedCache,
  removeAccountFromVault,
  saveAccountToVault,
  wsClient,
} from './lib/api.ts';
import { signOutFirebase } from './lib/firebase.ts';
import type {
  ActiveTab,
  AnnouncementItem,
  PostItem,
  SavedSessionAccount,
  StoryGroup,
  UserProfile,
} from './types.ts';

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [guestBrowsing, setGuestBrowsing] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [viewingUsername, setViewingUsername] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [posts, setPosts] = useState<PostItem[]>(() => readOfflineFeedCache<PostItem>());
  const [feedLoading, setFeedLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<UserProfile[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [dismissedAnnouncementIds, setDismissedAnnouncementIds] = useState<string[]>([]);

  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [studioOpen, setStudioOpen] = useState<'post' | 'story' | 'reel' | null>(null);
  const [storyViewerIndex, setStoryViewerIndex] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const [sharePost, setSharePost] = useState<PostItem | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const loadFeedAndStories = async (offset = 0, append = false) => {
    if (!append) setFeedLoading(true);
    try {
      const [feedRes, storyRes, sugRes] = await Promise.all([
        apiFetch<{ posts: PostItem[]; hasMore: boolean }>(
          `/api/posts/feed?limit=10&offset=${offset}`
        ),
        apiFetch<{ storyGroups: StoryGroup[] }>('/api/stories'),
        apiFetch<{ users: UserProfile[] }>('/api/profiles/suggested'),
      ]);

      setPosts((prev) => {
        const next = append ? [...prev, ...(feedRes.posts || [])] : feedRes.posts || [];
        if (!append) cacheFeedOffline(next);
        return next;
      });
      setHasMore(Boolean(feedRes.hasMore));
      setStoryGroups(storyRes.storyGroups || []);
      setSuggestedUsers(sugRes.users || []);
    } catch {
      // Keep offline cached feed when disconnected
    } finally {
      setFeedLoading(false);
    }
  };

  const loadAnnouncements = async () => {
    apiFetch<{ announcements: AnnouncementItem[] }>('/api/announcements/active')
      .then((res) => setAnnouncements(res.announcements || []))
      .catch(() => {});
  };

  // Bootstrap persistent session
  useEffect(() => {
    const token = getActiveToken();
    if (!token) {
      setAuthReady(true);
      wsClient.connect(null);
      return;
    }

    apiFetch<{ user: UserProfile; unreadNotifications: number }>('/api/auth/me')
      .then((res) => {
        setCurrentUser(res.user);
        setUnreadNotifications(res.unreadNotifications || 0);
        saveAccountToVault(token, res.user);
        wsClient.connect(token);
      })
      .catch(() => {
        wsClient.connect(null);
      })
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const canShowFeed =
      guestBrowsing ||
      Boolean(currentUser && (currentUser.has_rated || currentUser.role === 'super_admin') && !ratingModalOpen);
    if (!canShowFeed) return;
    loadFeedAndStories(0, false);
    loadAnnouncements();
  }, [authReady, currentUser?.id, currentUser?.has_rated, currentUser?.role, guestBrowsing, ratingModalOpen]);

  // Global real-time WebSocket listeners
  useEffect(() => {
    const offPost = wsClient.on('post:created', (newPost: PostItem) => {
      setPosts((prev) => (prev.some((p) => p.id === newPost.id) ? prev : [newPost, ...prev]));
    });
    const offLike = wsClient.on('post:liked', (data: { postId: string; likes_count: number }) => {
      setPosts((prev) => prev.map((p) => (p.id === data.postId ? { ...p, likes_count: data.likes_count } : p)));
    });
    const offComment = wsClient.on('post:commented', (data: { postId: string; comments_count: number }) => {
      setPosts((prev) => prev.map((p) => (p.id === data.postId ? { ...p, comments_count: data.comments_count } : p)));
    });
    const offDelete = wsClient.on('post:deleted', (data: { postId: string }) => {
      setPosts((prev) => prev.filter((p) => p.id !== data.postId));
    });
    const offNotif = wsClient.on('notification:new', () => {
      setUnreadNotifications((n) => n + 1);
    });
    const offAnn = wsClient.on('announcement:new', (ann: AnnouncementItem) => {
      setAnnouncements((prev) => [ann, ...prev]);
    });

    return () => {
      offPost();
      offLike();
      offComment();
      offDelete();
      offNotif();
      offAnn();
    };
  }, []);

  const handleAuthSuccess = (user: UserProfile, token: string) => {
    setCurrentUser(user);
    setAuthModalOpen(false);
    setActiveTab('home');
    wsClient.connect(token);
  };

  const handleLogout = () => {
    if (!currentUser) return;
    signOutFirebase();
    const nextAccount = removeAccountFromVault(currentUser.id);
    setSettingsOpen(false);
    if (nextAccount) {
      setCurrentUser(nextAccount.user);
      wsClient.connect(nextAccount.token);
    } else {
      setCurrentUser(null);
      setGuestBrowsing(false);
      wsClient.connect(null);
      setActiveTab('home');
    }
  };

  const openProfile = (username: string) => {
    setViewingUsername(username);
    setActiveTab('profile');
  };

  const handleStartChatWithUser = async (userId: string) => {
    if (!currentUser) return setAuthModalOpen(true);
    try {
      const res = await apiFetch<{ conversationId: string }>('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ memberIds: [userId], isGroup: false }),
      });
      setActiveConversationId(res.conversationId);
      setActiveTab('chat');
    } catch {
      // Ignore transient chat creation errors
    }
  };

  const handleNavProtected = (tab: ActiveTab) => {
    if ((tab === 'chat' || tab === 'notifications' || tab === 'profile') && !currentUser) {
      setAuthModalOpen(true);
      return;
    }
    if (tab === 'profile' && currentUser) {
      setViewingUsername(currentUser.username);
    }
    setActiveTab(tab);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="w-12 h-12 rounded-2xl vibe-gradient animate-pulse" />
      </div>
    );
  }

  if (authModalOpen || (!currentUser && !guestBrowsing)) {
    return (
      <AuthView
        onSuccess={handleAuthSuccess}
        canClose={true}
        onClose={() => {
          setAuthModalOpen(false);
          setGuestBrowsing(true);
        }}
      />
    );
  }

  // Gate Home Feed behind App Rating screen right after account creation (or when reopened from Settings)
  if (currentUser && ((!currentUser.has_rated && currentUser.role !== 'super_admin') || ratingModalOpen)) {
    return (
      <RatingScreen
        currentUser={currentUser}
        onRated={(updatedUser) => {
          setCurrentUser(updatedUser);
          setRatingModalOpen(false);
          setActiveTab('home');
          loadFeedAndStories(0, false);
        }}
      />
    );
  }

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';
  const activeBanner = announcements.find((a) => a.is_active && !dismissedAnnouncementIds.includes(a.id));

  const sidebarItems: { id: ActiveTab; label: string; icon: any; badge?: number }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'explore', label: 'Explore', icon: Compass },
    { id: 'reels', label: 'VibeReels', icon: Film },
    { id: 'chat', label: 'VibeChat', icon: MessageCircle },
    { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadNotifications },
    { id: 'profile', label: 'Profile', icon: User },
  ];
  if (isAdmin) {
    sidebarItems.push({ id: 'admin', label: 'Admin Center', icon: ShieldCheck });
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex flex-col lg:flex-row">
      {/* Desktop Collapsible Glass Sidebar */}
      <aside
        className={`hidden lg:flex flex-col justify-between sticky top-0 h-screen glass-panel border-y-0 border-l-0 transition-all duration-200 z-30 ${
          sidebarCollapsed ? 'w-20 px-3' : 'w-64 px-5'
        } py-6`}
      >
        <div className="space-y-7">
          {/* Brand + Collapse */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setActiveTab('home')}
              className="flex items-center gap-3 min-w-0"
            >
              <div className="w-10 h-10 rounded-xl vibe-gradient flex items-center justify-center font-display font-extrabold text-base text-white shrink-0 shadow-[0_0_20px_rgba(255,107,0,0.35)]">
                DV
              </div>
              {!sidebarCollapsed && (
                <span className="font-display text-xl font-bold tracking-tight vibe-text-gradient whitespace-nowrap">
                  DesiVibe
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label="Toggle sidebar"
              className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white shrink-0"
            >
              {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>

          {/* Primary Nav */}
          <nav className="space-y-1.5">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavProtected(item.id)}
                  className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                    active
                      ? 'bg-white/10 text-white border border-white/15 shadow-[0_0_20px_rgba(0,240,255,0.12)]'
                      : 'text-white/65 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <Icon
                    size={20}
                    className={
                      item.id === 'admin'
                        ? 'text-[#FF6B00]'
                        : active
                          ? 'text-[#00F0FF]'
                          : ''
                    }
                  />
                  {!sidebarCollapsed && <span className="flex-1 text-left">{item.label}</span>}
                  {!sidebarCollapsed && item.badge ? (
                    <span className="px-2 py-0.5 rounded-full bg-[#FF007F] text-[10px] font-mono-tabular font-bold text-white">
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-sm font-medium whitespace-nowrap text-white/65 hover:text-white hover:bg-white/[0.04] transition-all"
            >
              <Settings size={20} />
              {!sidebarCollapsed && <span className="flex-1 text-left">Settings & Info</span>}
            </button>

            {!sidebarCollapsed && <PWAInstallButton />}

            <button
              type="button"
              onClick={() => (currentUser ? setStudioOpen('reel') : setAuthModalOpen(true))}
              className="w-full mt-3 flex items-center justify-center gap-2 px-3.5 py-3 rounded-xl vibe-gradient-cta text-white text-sm font-semibold shadow-[0_0_20px_rgba(255,0,127,0.3)] hover:opacity-95"
            >
              <Plus size={18} />
              {!sidebarCollapsed && <span>Create</span>}
            </button>
          </nav>
        </div>

        {/* Bottom User / Sign In */}
        <div className="pt-4 border-t border-white/10">
          {currentUser ? (
            <button
              type="button"
              onClick={() => openProfile(currentUser.username)}
              className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.05] text-left"
            >
              <Avatar src={currentUser.avatar_url} name={currentUser.full_name} size="sm" online />
              {!sidebarCollapsed && (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <p className="text-xs font-semibold text-white truncate">{currentUser.username}</p>
                    <RoleAndVerifiedBadge role={currentUser.role} isVerified={currentUser.is_verified} size={13} />
                  </div>
                  <p className="text-[11px] text-white/50 truncate">{currentUser.full_name}</p>
                </div>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white"
            >
              <LogIn size={16} />
              {!sidebarCollapsed && <span>Sign In / Register</span>}
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-24 lg:pb-10">
        {/* Mobile Top Header (Compact <= 56px) */}
        <header className="lg:hidden sticky top-0 z-30 h-14 px-4 glass-panel border-x-0 border-t-0 flex items-center justify-between gap-4">
          <button type="button" onClick={() => setActiveTab('home')} className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg vibe-gradient flex items-center justify-center font-display font-extrabold text-xs text-white">
              DV
            </div>
            <span className="font-display text-lg font-bold vibe-text-gradient whitespace-nowrap">DesiVibe</span>
          </button>

          <div className="flex items-center gap-0.5 shrink-0">
            <PWAInstallButton compact />
            {isAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab('admin')}
                aria-label="Admin Center"
                className="w-11 h-11 rounded-full flex items-center justify-center text-[#FF6B00]"
              >
                <ShieldCheck size={20} />
              </button>
            )}
            <button
              type="button"
              onClick={() => handleNavProtected('notifications')}
              aria-label="Notifications"
              className="relative w-11 h-11 rounded-full flex items-center justify-center text-white/85"
            >
              <Bell size={20} />
              {unreadNotifications > 0 && (
                <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-[#FF007F]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => handleNavProtected('chat')}
              aria-label="VibeChat"
              className="w-11 h-11 rounded-full flex items-center justify-center text-white/85"
            >
              <MessageCircle size={20} />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              className="w-11 h-11 rounded-full flex items-center justify-center text-white/85"
            >
              <Settings size={20} />
            </button>
            {!currentUser && (
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="ml-1 px-3 py-1.5 rounded-xl vibe-gradient-cta text-xs font-semibold text-white whitespace-nowrap"
              >
                Sign In
              </button>
            )}
          </div>
        </header>

        {/* Global App-Wide Announcement Banner */}
        {activeBanner && (
          <div className="mx-4 sm:mx-6 mt-4 px-4 py-3 rounded-2xl bg-gradient-to-r from-[#FF6B00]/15 via-[#FF007F]/15 to-[#00F0FF]/15 border border-white/15 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Megaphone size={16} className="text-[#FF6B00] shrink-0" />
              <p className="text-xs text-white/90 truncate">
                <span className="font-semibold text-white mr-1.5">{activeBanner.title}:</span>
                {activeBanner.body}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissedAnnouncementIds((prev) => [...prev, activeBanner.id])}
              aria-label="Dismiss announcement"
              className="text-white/60 hover:text-white shrink-0"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* Viewport Workspace */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-5">
          {activeTab === 'home' && (
            <HomeFeed
              posts={posts}
              loading={feedLoading}
              hasMore={hasMore}
              storyGroups={storyGroups}
              suggestedUsers={suggestedUsers}
              currentUser={currentUser}
              onRefresh={() => loadFeedAndStories(0, false)}
              onLoadMore={() => loadFeedAndStories(posts.length, true)}
              onSelectStoryGroup={(idx) => setStoryViewerIndex(idx)}
              onCreateStory={() => (currentUser ? setStudioOpen('story') : setAuthModalOpen(true))}
              onCreatePost={() => (currentUser ? setStudioOpen('reel') : setAuthModalOpen(true))}
              onOpenProfile={openProfile}
              onRequireAuth={() => setAuthModalOpen(true)}
              onPostMutated={(postId, patch) =>
                setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)))
              }
              onPostDeleted={(postId) => setPosts((prev) => prev.filter((p) => p.id !== postId))}
              onShareToChat={(post) => (currentUser ? setSharePost(post) : setAuthModalOpen(true))}
              onSuggestedFollowChange={(userId, status) =>
                setSuggestedUsers((prev) =>
                  prev.map((u) => (u.id === userId ? { ...u, follow_status: status } : u))
                )
              }
            />
          )}

          {activeTab === 'explore' && (
            <ExploreView
              currentUser={currentUser}
              onOpenProfile={openProfile}
              onOpenReels={() => setActiveTab('reels')}
              onRequireAuth={() => setAuthModalOpen(true)}
              onPostMutated={(postId, patch) =>
                setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)))
              }
              onPostDeleted={(postId) => setPosts((prev) => prev.filter((p) => p.id !== postId))}
              onShareToChat={(post) => (currentUser ? setSharePost(post) : setAuthModalOpen(true))}
            />
          )}

          {activeTab === 'reels' && (
            <ReelsFeed
              currentUser={currentUser}
              onOpenProfile={openProfile}
              onRequireAuth={() => setAuthModalOpen(true)}
              onShareToChat={(post) => (currentUser ? setSharePost(post) : setAuthModalOpen(true))}
              onUploadReel={() => (currentUser ? setStudioOpen('reel') : setAuthModalOpen(true))}
            />
          )}

          {activeTab === 'chat' && currentUser && (
            <ChatView
              currentUser={currentUser}
              initialConversationId={activeConversationId}
              onOpenProfile={openProfile}
            />
          )}

          {activeTab === 'notifications' && currentUser && (
            <NotificationsView
              onOpenProfile={openProfile}
              onUnreadChange={(cnt) => setUnreadNotifications(cnt)}
            />
          )}

          {activeTab === 'profile' && (
            <ProfileView
              username={viewingUsername || currentUser?.username || ''}
              currentUser={currentUser}
              onRequireAuth={() => setAuthModalOpen(true)}
              onStartChat={handleStartChatWithUser}
              onOpenSettings={() => setSettingsOpen(true)}
              onProfileUpdated={(u) => setCurrentUser(u)}
              onOpenProfile={openProfile}
              onPostMutated={(postId, patch) =>
                setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)))
              }
              onPostDeleted={(postId) => setPosts((prev) => prev.filter((p) => p.id !== postId))}
              onShareToChat={(post) => (currentUser ? setSharePost(post) : setAuthModalOpen(true))}
            />
          )}

          {activeTab === 'admin' && isAdmin && currentUser && (
            <AdminDashboard
              currentUser={currentUser}
              onAnnouncementPosted={loadAnnouncements}
            />
          )}
        </main>
      </div>

      {/* Mobile Floating Pill-Shaped Bottom Navigation */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-3 left-4 right-4 z-40 h-14 rounded-full glass-panel shadow-[0_10px_32px_rgba(0,0,0,0.65)] border border-white/15 px-3 flex items-center justify-around"
      >
        <button
          type="button"
          onClick={() => handleNavProtected('home')}
          aria-label="Home"
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full ${
            activeTab === 'home' ? 'text-[#00F0FF]' : 'text-white/65'
          }`}
        >
          <Home size={21} />
        </button>

        <button
          type="button"
          onClick={() => handleNavProtected('explore')}
          aria-label="Explore"
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full ${
            activeTab === 'explore' ? 'text-[#00F0FF]' : 'text-white/65'
          }`}
        >
          <Compass size={21} />
        </button>

        <button
          type="button"
          onClick={() => (currentUser ? setStudioOpen('reel') : setAuthModalOpen(true))}
          aria-label="Create"
          className="w-11 h-11 rounded-full vibe-gradient-cta text-white flex items-center justify-center shadow-[0_0_18px_rgba(255,0,127,0.45)]"
        >
          <Plus size={22} />
        </button>

        <button
          type="button"
          onClick={() => handleNavProtected('reels')}
          aria-label="VibeReels"
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full ${
            activeTab === 'reels' ? 'text-[#00F0FF]' : 'text-white/65'
          }`}
        >
          <Film size={21} />
        </button>

        <button
          type="button"
          onClick={() => handleNavProtected('profile')}
          aria-label="Profile"
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full ${
            activeTab === 'profile' ? 'text-[#00F0FF]' : 'text-white/65'
          }`}
        >
          <User size={21} />
        </button>
      </nav>

      {/* Modals */}
      {studioOpen && (
        <CreateStudioModal
          initialMode={studioOpen}
          onClose={() => setStudioOpen(null)}
          onPublished={(type, createdPost) => {
            if (createdPost) {
              setPosts((prev) => (prev.some((p) => p.id === createdPost.id) ? prev : [createdPost, ...prev]));
            }
            if (type === 'post') {
              setActiveTab('home');
            } else if (type === 'reel') {
              setActiveTab('reels');
            } else {
              loadFeedAndStories(0, false);
            }
          }}
        />
      )}

      {storyViewerIndex !== null && (
        <StoryViewerModal
          groups={storyGroups}
          initialGroupIndex={storyViewerIndex}
          currentUser={currentUser}
          onClose={() => setStoryViewerIndex(null)}
          onRequireAuth={() => {
            setStoryViewerIndex(null);
            setAuthModalOpen(true);
          }}
          onStorySeen={(storyId) => {
            setStoryGroups((prev) =>
              prev.map((g) => ({
                ...g,
                stories: g.stories.map((s) => (s.id === storyId ? { ...s, seen: 1 } : s)),
                hasUnseen: g.stories.some((s) => (s.id === storyId ? false : !s.seen)),
              }))
            );
          }}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          currentUser={currentUser}
          onClose={() => setSettingsOpen(false)}
          onSwitchAccount={(acc: SavedSessionAccount) => {
            setCurrentUser(acc.user);
            wsClient.connect(acc.token);
            setViewingUsername(acc.user.username);
          }}
          onAddAccount={() => {
            setSettingsOpen(false);
            setAuthModalOpen(true);
          }}
          onLogout={handleLogout}
          onUserUpdated={(u) => setCurrentUser(u)}
          onOpenRating={() => setRatingModalOpen(true)}
        />
      )}

      {sharePost && (
        <ShareToChatModal
          post={sharePost}
          onClose={() => setSharePost(null)}
          onShared={(convId) => {
            setSharePost(null);
            setActiveConversationId(convId);
            setActiveTab('chat');
          }}
        />
      )}

      <OfflineIndicator />
    </div>
  );
}
