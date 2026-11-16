import { CheckCheck, Image as ImageIcon, Mic, Plus, Send, Square, Trash2, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiFetch, getActiveToken, wsClient } from '../lib/api.ts';
import { compressImageFile, uploadMediaWithProgress } from '../lib/media.ts';
import type { ConversationItem, MessageItem, UserProfile } from '../types.ts';
import { Avatar, timeAgo } from './Avatar.tsx';

interface ChatViewProps {
  currentUser: UserProfile;
  initialConversationId?: string | null;
  onOpenProfile: (username: string) => void;
}

const MSG_REACTIONS = ['❤️', '🔥', '😂', '👏'];

export function ChatView({ currentUser, initialConversationId, onOpenProfile }: ChatViewProps) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(initialConversationId || null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [text, setText] = useState('');
  const [typingUserIds, setTypingUserIds] = useState<Record<string, boolean>>({});
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [suggestedUsers, setSuggestedUsers] = useState<UserProfile[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [recording, setRecording] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = async () => {
    try {
      const res = await apiFetch<{ conversations: ConversationItem[] }>('/api/chat/conversations');
      setConversations(res.conversations || []);
      if (!activeConvId && res.conversations?.length > 0) {
        setActiveConvId(res.conversations[0].id);
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (initialConversationId) setActiveConvId(initialConversationId);
  }, [initialConversationId]);

  useEffect(() => {
    if (!activeConvId) return;
    apiFetch<{ messages: MessageItem[] }>(`/api/chat/conversations/${activeConvId}/messages`)
      .then((res) => {
        setMessages(res.messages || []);
        apiFetch(`/api/chat/conversations/${activeConvId}/read`, { method: 'POST' }).catch(() => {});
        setConversations((prev) => prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0 } : c)));
      })
      .catch(() => {});
  }, [activeConvId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    const offMsg = wsClient.on('chat:message', (msg: MessageItem) => {
      if (msg.conversation_id === activeConvId) {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        apiFetch(`/api/chat/conversations/${activeConvId}/read`, { method: 'POST' }).catch(() => {});
      }
      loadConversations();
    });

    const offTyping = wsClient.on('chat:typing', (data: { conversationId: string; userId: string; isTyping: boolean }) => {
      if (data.conversationId === activeConvId && data.userId !== currentUser.id) {
        setTypingUserIds((prev) => ({ ...prev, [data.userId]: data.isTyping }));
      }
    });

    const offReact = wsClient.on('chat:reaction', (data: { messageId: string; conversationId: string; reactions: any[] }) => {
      if (data.conversationId === activeConvId) {
        setMessages((prev) => prev.map((m) => (m.id === data.messageId ? { ...m, reactions: data.reactions } : m)));
      }
    });

    const offDelete = wsClient.on('chat:delete', (data: { messageId: string; conversationId: string }) => {
      if (data.conversationId === activeConvId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === data.messageId ? { ...m, is_deleted: 1, content: 'Message deleted', media_url: '' } : m))
        );
      }
    });

    const offPresence = wsClient.on('presence:update', (data: { userId: string; online: boolean }) => {
      setConversations((prev) =>
        prev.map((c) => ({
          ...c,
          members: c.members.map((m) => (m.id === data.userId ? { ...m, online: data.online } : m)),
        }))
      );
    });

    return () => {
      offMsg();
      offTyping();
      offReact();
      offDelete();
      offPresence();
    };
  }, [activeConvId, currentUser.id]);

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const otherMembers = activeConv?.members.filter((m) => m.id !== currentUser.id) || [];
  const convTitle = activeConv
    ? activeConv.is_group
      ? activeConv.name || activeConv.members.map((m) => m.username).join(', ')
      : otherMembers[0]?.full_name || otherMembers[0]?.username || 'Direct Chat'
    : 'VibeChat';

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConvId || !text.trim()) return;
    const body = text.trim();
    setText('');
    wsClient.send('chat:typing', { conversationId: activeConvId, isTyping: false });
    await apiFetch(`/api/chat/conversations/${activeConvId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: body, mediaType: 'text' }),
    }).catch(() => {});
  };

  const handleUploadImage = async (file: File) => {
    if (!activeConvId) return;
    const token = getActiveToken();
    if (!token) return;
    try {
      const compressed = await compressImageFile(file, { maxWidth: 1200, quality: 0.82 });
      const uploaded = await uploadMediaWithProgress(compressed, 'chat-media', token, () => {}).promise;
      await apiFetch(`/api/chat/conversations/${activeConvId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ mediaUrl: uploaded.url, mediaType: 'image', content: '' }),
      });
    } catch {
      // Ignore failed upload
    }
  };

  const toggleVoiceRecording = async () => {
    if (!activeConvId) return;
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
        const token = getActiveToken();
        if (token) {
          try {
            const uploaded = await uploadMediaWithProgress(file, 'chat-media', token, () => {}).promise;
            await apiFetch(`/api/chat/conversations/${activeConvId}/messages`, {
              method: 'POST',
              body: JSON.stringify({ mediaUrl: uploaded.url, mediaType: 'voice', content: 'Voice note' }),
            });
          } catch {
            // Ignore failed voice note upload
          }
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      // Microphone unavailable
    }
  };

  const openNewChatModal = async () => {
    setNewChatOpen(true);
    const res = await apiFetch<{ users: UserProfile[] }>('/api/profiles/suggested').catch(() => ({ users: [] }));
    setSuggestedUsers(res.users || []);
    setSelectedUserIds([]);
    setGroupName('');
  };

  const createConversation = async () => {
    if (selectedUserIds.length === 0) return;
    try {
      const res = await apiFetch<{ conversationId: string }>('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({
          memberIds: selectedUserIds,
          isGroup: selectedUserIds.length > 1,
          name: groupName,
        }),
      });
      setNewChatOpen(false);
      await loadConversations();
      setActiveConvId(res.conversationId);
    } catch {
      // Ignore
    }
  };

  const someoneTyping = Object.values(typingUserIds).some(Boolean);

  return (
    <div className="glass-panel rounded-3xl overflow-hidden grid grid-cols-1 md:grid-cols-12 h-[78vh] min-h-[540px]">
      {/* Conversation Sidebar */}
      <div className="md:col-span-4 border-b md:border-b-0 md:border-r border-white/10 flex flex-col">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-white">VibeChat</h2>
          <button
            type="button"
            onClick={openNewChatModal}
            className="px-3 py-1.5 rounded-xl vibe-gradient-cta text-white text-xs font-semibold flex items-center gap-1"
          >
            <Plus size={14} /> New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06]">
          {conversations.length === 0 ? (
            <div className="p-6 text-center space-y-2">
              <p className="text-xs text-white/55">No conversations yet.</p>
              <button type="button" onClick={openNewChatModal} className="text-xs text-[#00F0FF] font-semibold">
                Start a VibeChat
              </button>
            </div>
          ) : (
            conversations.map((conv) => {
              const others = conv.members.filter((m) => m.id !== currentUser.id);
              const primary = others[0];
              const isOnline = others.some((m) => m.online);
              const title = conv.is_group
                ? conv.name || others.map((m) => m.username).join(', ')
                : primary?.full_name || primary?.username || 'Chat';

              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => setActiveConvId(conv.id)}
                  className={`w-full p-3.5 flex items-center gap-3 text-left transition-colors ${
                    conv.id === activeConvId ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  {conv.is_group ? (
                    <div className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center text-[#00F0FF] shrink-0">
                      <Users size={18} />
                    </div>
                  ) : (
                    <Avatar src={primary?.avatar_url} name={title} size="md" online={isOnline} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white truncate">{title}</p>
                      {conv.unreadCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-[#FF007F] text-[10px] font-mono-tabular font-bold text-white">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/50 truncate">
                      {conv.lastMessage?.content || (conv.lastMessage ? 'Media shared' : 'Say hi')}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Active Message Thread */}
      <div className="md:col-span-8 flex flex-col bg-[#0A0A0F]/45">
        {activeConv ? (
          <>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div
                onClick={() => !activeConv.is_group && otherMembers[0] && onOpenProfile(otherMembers[0].username)}
                className="flex items-center gap-3 cursor-pointer"
              >
                <Avatar
                  src={otherMembers[0]?.avatar_url}
                  name={convTitle}
                  size="sm"
                  online={otherMembers.some((m) => m.online)}
                />
                <div>
                  <p className="text-sm font-semibold text-white">{convTitle}</p>
                  <p className="text-[11px] text-white/55">
                    {someoneTyping
                      ? 'Typing...'
                      : otherMembers.some((m) => m.online)
                        ? 'Online now'
                        : activeConv.is_group
                          ? `${activeConv.members.length} members`
                          : `@${otherMembers[0]?.username || ''}`}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((m) => {
                const isMine = m.sender_id === currentUser.id;
                let sharedThumb = '';
                if (m.shared_media_urls) {
                  try {
                    sharedThumb = JSON.parse(m.shared_media_urls)[0] || '';
                  } catch {
                    sharedThumb = '';
                  }
                }

                return (
                  <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`group relative max-w-[78%] rounded-2xl px-4 py-2.5 text-sm ${
                        isMine
                          ? 'vibe-gradient-cta text-white rounded-br-sm'
                          : 'bg-[#15151F] border border-white/10 text-white/95 rounded-bl-sm'
                      }`}
                    >
                      {!isMine && activeConv.is_group ? (
                        <p className="text-[11px] font-semibold text-[#00F0FF] mb-1">@{m.username}</p>
                      ) : null}

                      {m.media_type === 'image' && m.media_url && !m.is_deleted && (
                        <img
                          src={m.media_url}
                          alt="Chat media"
                          referrerPolicy="no-referrer"
                          className="rounded-xl max-h-60 object-cover mb-1.5"
                        />
                      )}

                      {m.media_type === 'voice' && m.media_url && !m.is_deleted && (
                        <audio src={m.media_url} controls className="max-w-[230px] h-9 mb-1" />
                      )}

                      {(m.media_type === 'post_share' || m.media_type === 'reel_share') && m.shared_post_id && (
                        <div className="mb-2 rounded-xl overflow-hidden bg-black/35 border border-white/15">
                          {sharedThumb && (
                            <img src={sharedThumb} alt="Shared post" className="w-full max-h-44 object-cover" />
                          )}
                          <div className="p-2 text-xs">
                            <p className="font-semibold text-white">@{m.shared_author_username}</p>
                            <p className="text-white/75 line-clamp-2">{m.shared_caption}</p>
                          </div>
                        </div>
                      )}

                      {m.content && (
                        <p className={m.is_deleted ? 'italic text-white/55 text-xs' : 'leading-relaxed'}>
                          {m.content}
                        </p>
                      )}

                      {/* Quick reaction bar & delete */}
                      {!m.is_deleted && (
                        <div className="hidden group-hover:flex items-center gap-1 mt-1.5 pt-1 border-t border-white/15">
                          {MSG_REACTIONS.map((em) => (
                            <button
                              key={em}
                              type="button"
                              onClick={() =>
                                apiFetch(`/api/chat/messages/${m.id}/react`, {
                                  method: 'POST',
                                  body: JSON.stringify({ emoji: em }),
                                })
                              }
                              className="text-xs hover:scale-125 transition-transform px-1"
                            >
                              {em}
                            </button>
                          ))}
                          {isMine && (
                            <button
                              type="button"
                              onClick={() => apiFetch(`/api/chat/messages/${m.id}`, { method: 'DELETE' })}
                              className="ml-auto text-white/70 hover:text-white px-1"
                              aria-label="Delete message"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {m.reactions?.length > 0 && (
                      <div className="flex gap-1 mt-1 px-1">
                        {m.reactions.map((r, i) => (
                          <span key={i} className="text-xs bg-white/10 rounded-full px-1.5 py-0.5">
                            {r.emoji}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-1 mt-0.5 px-1 text-[10px] text-white/40">
                      <span>{timeAgo(m.created_at)}</span>
                      {isMine && <CheckCheck size={12} className="text-[#00F0FF]" />}
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            <form onSubmit={handleSendText} className="p-3 border-t border-white/10 flex items-center gap-2">
              <label className="w-10 h-10 rounded-xl bg-white/[0.06] hover:bg-white/10 flex items-center justify-center text-white/80 cursor-pointer shrink-0">
                <ImageIcon size={18} />
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => e.target.files?.[0] && handleUploadImage(e.target.files[0])}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={toggleVoiceRecording}
                aria-label={recording ? 'Stop voice note' : 'Record voice note'}
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  recording ? 'bg-rose-500 text-white animate-pulse' : 'bg-white/[0.06] hover:bg-white/10 text-white/80'
                }`}
              >
                {recording ? <Square size={16} /> : <Mic size={18} />}
              </button>

              <input
                type="text"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  wsClient.send('chat:typing', {
                    conversationId: activeConvId,
                    isTyping: e.target.value.length > 0,
                  });
                }}
                placeholder="Message..."
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#00F0FF]"
              />

              <button
                type="submit"
                aria-label="Send message"
                className="w-11 h-11 rounded-xl vibe-gradient-cta text-white flex items-center justify-center shrink-0"
              >
                <Send size={17} />
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
            <p className="font-display font-semibold text-white">Select or start a VibeChat</p>
            <p className="text-xs text-white/55 max-w-xs">
              Real-time 1-to-1 and group messaging with voice notes, photo sharing, reactions, and read receipts.
            </p>
            <button
              type="button"
              onClick={openNewChatModal}
              className="px-4 py-2 rounded-xl vibe-gradient-cta text-xs font-semibold text-white"
            >
              Start Conversation
            </button>
          </div>
        )}
      </div>

      {/* New Chat / Group Chat Modal */}
      {newChatOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-3xl p-5 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold text-white">New Conversation</h3>
              <button type="button" onClick={() => setNewChatOpen(false)} className="text-xs text-white/60">
                Close
              </button>
            </div>
            {selectedUserIds.length > 1 && (
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group chat name..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F] border border-white/15 text-xs text-white"
              />
            )}
            <div className="max-h-60 overflow-y-auto space-y-2">
              {suggestedUsers.map((u) => {
                const picked = selectedUserIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() =>
                      setSelectedUserIds((prev) =>
                        picked ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                      )
                    }
                    className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left ${
                      picked ? 'bg-[#00F0FF]/15 border-[#00F0FF]/50' : 'bg-white/[0.03] border-white/10'
                    }`}
                  >
                    <Avatar src={u.avatar_url} name={u.full_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">{u.full_name}</p>
                      <p className="text-xs text-white/55 truncate">@{u.username}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={createConversation}
              disabled={selectedUserIds.length === 0}
              className="w-full py-2.5 rounded-xl vibe-gradient-cta text-xs font-semibold text-white disabled:opacity-40"
            >
              {selectedUserIds.length > 1 ? 'Create Group Chat' : 'Start Chat'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
