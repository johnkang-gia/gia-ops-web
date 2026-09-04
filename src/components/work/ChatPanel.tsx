"use client";

import { ackRequiredEmails, realPeople } from "@/lib/taskAck";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { genCaseId } from "@/lib/caseId";
import type { ChatMessage, Department, MessageReaction, MessageRead, Task, TeamMember } from "@/lib/types";
import { nameFor, extractMentionedEmails } from "@/lib/teamName";
import { parseTaskFromMessage } from "@/lib/parseTaskFromMessage";
import { deadlineLabel } from "@/lib/deadlineLabel";
import { uploadChatFile, getChatFileSignedUrl, deleteChatFile } from "@/lib/storage";
import { friendlyError } from "@/lib/errorMessage";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useToast } from "@/components/common/ToastProvider";
import LinkPreviewCard from "./LinkPreviewCard";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🎉", "👏", "🔥", "😅", "🤔", "✅"];
const TYPING_EXPIRE_MS = 3000;
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const MARK_READ_DEBOUNCE_MS = 1500;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function oneLine(text: string, maxLen = 40) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

function isSystemMsg(content: string) {
  return content.startsWith("✅ 업무로 등록됨");
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// 메시지 안에서 첫 번째 링크를 찾아 미리보기 카드를 붙일 때 씁니다. 문장 끝의 마침표/쉼표/괄호
// 등이 URL에 딸려 들어오는 걸 대충 정리합니다(완벽하진 않지만 채팅 문장에서는 충분합니다).
function firstUrlIn(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/);
  if (!m) return null;
  return m[0].replace(/[),.!?，。]+$/, "");
}

// "@전체"는 실제 팀원 이름이 아니라 "이 부서 채팅을 보는 모두"를 부르는 특수 태그입니다.
// extractMentionedEmails(팀원 이름과 매칭)에는 걸리지 않으므로 업무 등록 시 담당자로 착각해
// 들어가는 일은 없고, 화면에서만 눈에 띄게(주황색+📢) 강조해서 "다 같이 봐야 할 말"임을
// 표시합니다.
const ALL_MENTION = "전체";

// 메시지에서 "#부서명" 태그를 찾아, 지금 보고 있는 부서를 제외한 실제 부서명과 매칭합니다.
function extractTaggedDepartments(text: string, departments: Department[], current: string): string[] {
  const tags = [...text.matchAll(/#([가-힣a-zA-Z0-9]+)/g)].map((m) => m[1]);
  return departments.filter((d) => d.name !== current && tags.includes(d.name)).map((d) => d.name);
}

// @이름 / #부서명 토큰과 **굵게** / *기울임* / ~~취소선~~ / `코드` 마크다운을 함께 렌더링합니다.
// 구글챗처럼 자주 쓰는 텍스트 서식을 별도 툴바 없이 문법만으로 바로 쓸 수 있게 했습니다.
function renderMessageText(text: string, departments: Department[]) {
  const TOKEN_RE = /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|@\S+|#\S+|\*[^*\n]+\*)/g;
  const parts = text.split(TOKEN_RE);
  const nodes: React.ReactNode[] = [];

  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      nodes.push(<strong key={i}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith("~~") && part.endsWith("~~") && part.length > 4) {
      nodes.push(
        <del key={i} className="opacity-60">
          {part.slice(2, -2)}
        </del>
      );
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      nodes.push(
        <code key={i} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[12px]">
          {part.slice(1, -1)}
        </code>
      );
    } else if (part.startsWith("@")) {
      const isAll = part === `@${ALL_MENTION}`;
      nodes.push(
        <span
          key={i}
          className={
            isAll
              ? "rounded bg-amber-100 px-1 py-0.5 font-bold text-amber-700"
              : "rounded bg-blue-100 px-1 py-0.5 font-semibold text-blue-700"
          }
        >
          {isAll ? `📢 ${part}` : part}
        </span>
      );
    } else if (part.startsWith("#")) {
      const dept = departments.find((d) => d.name === part.slice(1));
      const color = dept?.color || "#f59e0b";
      nodes.push(
        <span key={i} style={{ backgroundColor: color + "22", color }} className="rounded px-1 py-0.5 font-semibold">
          {part}
        </span>
      );
    } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      nodes.push(<em key={i}>{part.slice(1, -1)}</em>);
    } else {
      // 일반 텍스트 - 줄바꿈(\n)을 <br/>로 바꿔가며 그대로 출력합니다.
      part.split("\n").forEach((line, li) => {
        if (li > 0) nodes.push(<br key={`${i}-br-${li}`} />);
        if (line) nodes.push(<span key={`${i}-${li}`}>{line}</span>);
      });
    }
  });

  return nodes;
}

export default function ChatPanel({
  department,
  departments,
  team,
  userEmail,
  tasks,
  onTaskCreated,
}: {
  department: string;
  departments: Department[];
  team: TeamMember[];
  userEmail: string;
  tasks: Task[];
  onTaskCreated?: (task: Task) => void;
}) {
  const confirmAction = useConfirm();
  const notify = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [reads, setReads] = useState<Record<string, string>>({}); // email -> last_read_at
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastMarkReadRef = useRef(0);

  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [showHashMenu, setShowHashMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [hashFilter, setHashFilter] = useState("");

  // 답장(인용) 대상 - 메시지 옆 ↩️를 누르면 여기 담기고, 입력창 위에 미리보기로 뜹니다.
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  // 수정 중인 메시지 id/내용 - 말풍선이 그 자리에서 바로 입력창으로 바뀝니다.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // 이모지 반응 고르는 작은 팝업 위치.
  const [reactionPopup, setReactionPopup] = useState<{ messageId: string; top: number; left: number } | null>(null);
  // 지금 입력 중인 다른 사람들(이메일 -> 이름/마지막 타이핑 시각). 3초 넘게 조용하면 자동으로 사라집니다.
  const [typingUsers, setTypingUsers] = useState<Record<string, { name: string; ts: number }>>({});
  const typingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTypingSentRef = useRef(0);

  // 파일 첨부 업로드 상태 + signed URL 캐시(경로별로 한 번만 발급받습니다).
  const [uploadingFile, setUploadingFile] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});

  // 고정된 메시지 목록 펼침/접힘, 검색창 열림 상태, 스크롤 이동 후 잠깐 반짝이는 하이라이트.
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // 메시지를 클릭하면 뜨는 "업무로 등록" 작은 팝업 상태입니다.
  const [taskPopup, setTaskPopup] = useState<{ message: ChatMessage; top: number; left: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // 실시간 연결 상태를 화면에 보여줍니다("실시간 채팅이 제대로 돌아가는지" 눈으로 확인할 수 있게).
  // 웹소켓이 끊겼다가 다시 붙는 경우(와이파이 전환, 노트북 잠깐 절전 등) Supabase Realtime은
  // 끊겨 있던 동안의 이벤트를 다시 보내주지 않으므로, SUBSCRIBED 상태로 돌아올 때마다 최근
  // 메시지를 다시 불러와서 놓친 메시지가 없도록 채웁니다.
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);

    // merge=true는 재연결 시 씁니다 - 최근 100건으로 전체를 덮어쓰면, 검색으로 점프해서 보고
    // 있던 옛날 메시지나 그 반응이 화면에서 그냥 사라져버립니다. 대신 기존 목록에 최신 값을
    // 얹어(병합) 넣어서, 놓친 변경분은 반영하되 이미 보고 있던 내용은 유지합니다.
    async function loadRecentMessages(merge = false) {
      const { data } = await supabase
        .from("messages")
        .select(
          "id, department, author_email, content, source_department, reply_to_id, edited_at, attachment_path, attachment_name, attachment_type, attachment_size, pinned_at, pinned_by, created_at"
        )
        .eq("department", department)
        .order("created_at", { ascending: true })
        .limit(100);
      if (cancelled) return;
      const msgs = (data as ChatMessage[] | null) ?? [];
      if (merge) {
        setMessages((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m]));
          for (const m of msgs) byId.set(m.id, m);
          return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
        });
      } else {
        setMessages(msgs);
      }

      if (msgs.length === 0) {
        if (!merge) setReactions([]);
        return;
      }
      const { data: reactionData } = await supabase
        .from("message_reactions")
        .select("id, message_id, department, emoji, author_email, created_at")
        .in(
          "message_id",
          msgs.map((m) => m.id)
        );
      if (cancelled) return;
      if (merge) {
        setReactions((prev) => {
          const byId = new Map(prev.map((r) => [r.id, r]));
          for (const r of (reactionData as MessageReaction[] | null) ?? []) byId.set(r.id, r);
          return [...byId.values()];
        });
      } else {
        setReactions((reactionData as MessageReaction[] | null) ?? []);
      }
    }

    async function loadReads() {
      const { data } = await supabase
        .from("message_reads")
        .select("department, user_email, last_read_at")
        .eq("department", department);
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const r of (data as MessageRead[] | null) ?? []) map[r.user_email] = r.last_read_at;
      setReads(map);
    }

    loadRecentMessages();
    loadReads();

    const channel = supabase
      .channel(`messages-${department}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `department=eq.${department}` },
        (payload) => {
          setMessages((prev) => {
            const next = payload.new as ChatMessage;
            if (prev.some((m) => m.id === next.id)) return prev;
            return [...prev, next];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `department=eq.${department}` },
        (payload) => {
          const next = payload.new as ChatMessage;
          setMessages((prev) => prev.map((m) => (m.id === next.id ? next : m)));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: `department=eq.${department}` },
        (payload) => {
          const removed = payload.old as { id: string };
          setMessages((prev) => prev.filter((m) => m.id !== removed.id));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions", filter: `department=eq.${department}` },
        (payload) => {
          const next = payload.new as MessageReaction;
          setReactions((prev) => {
            if (
              prev.some(
                (r) =>
                  r.id === next.id ||
                  (r.message_id === next.message_id && r.emoji === next.emoji && r.author_email === next.author_email)
              )
            )
              return prev;
            return [...prev, next];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions", filter: `department=eq.${department}` },
        (payload) => {
          const removed = payload.old as { id: string };
          setReactions((prev) => prev.filter((r) => r.id !== removed.id));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reads", filter: `department=eq.${department}` },
        (payload) => {
          const next = payload.new as MessageRead;
          setReads((prev) => ({ ...prev, [next.user_email]: next.last_read_at }));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "message_reads", filter: `department=eq.${department}` },
        (payload) => {
          const next = payload.new as MessageRead;
          setReads((prev) => ({ ...prev, [next.user_email]: next.last_read_at }));
        }
      )
      .on("broadcast", { event: "typing" }, (msg) => {
        const p = msg.payload as { email: string; name: string };
        if (!p?.email || p.email === userEmail) return;
        setTypingUsers((prev) => ({ ...prev, [p.email]: { name: p.name, ts: Date.now() } }));
        clearTimeout(typingTimersRef.current[p.email]);
        typingTimersRef.current[p.email] = setTimeout(() => {
          setTypingUsers((prev) => {
            const next = { ...prev };
            delete next[p.email];
            return next;
          });
        }, TYPING_EXPIRE_MS);
      })
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          // 재연결된 경우(처음 연결이면 어차피 messages가 비어있는 상태와 동일해 무해함) 놓친
          // 메시지를 보충합니다.
          setConnected((wasConnected) => {
            if (!wasConnected) loadRecentMessages(true);
            return true;
          });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnected(false);
        }
      });

    channelRef.current = channel;

    // 웹소켓이 백그라운드 탭에서 조용히 끊긴 채로 있다가(브라우저가 절전 모드로 접속을 줄이는
    // 경우 흔함) 다시 탭으로 돌아왔을 때 "SUBSCRIBED" 콜백이 바로 안 오는 경우가 있어, 탭이
    // 다시 보이거나 창에 포커스가 돌아올 때마다 한 번 더 최신 메시지를 불러와 안전망을 둡니다
    // - "채팅이 늦게 뜬다"는 증상의 상당수가 이런 조용한 재연결 지연 때문입니다.
    function handleVisible() {
      if (document.visibilityState === "visible") loadRecentMessages(true);
    }
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);

    return () => {
      cancelled = true;
      channelRef.current = null;
      for (const t of Object.values(typingTimersRef.current)) clearTimeout(t);
      typingTimersRef.current = {};
      setTypingUsers({});
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
      supabase.removeChannel(channel);
    };
  }, [department, userEmail]);

  // 메시지 목록이 바뀔 때마다 무조건 맨 아래로 스크롤하면, 위로 스크롤해서 이전 대화를 읽는
  // 중에도 다른 사람이 메시지를 보낼 때마다 화면이 확 튀는 문제가 있었습니다. 사용자가 이미
  // 맨 아래쪽 근처에 있을 때만 자동으로 따라 내려가고, 위로 올려서 읽고 있으면 그대로 둡니다.
  const wasNearBottomRef = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    function updateNearBottom() {
      const threshold = 120;
      wasNearBottomRef.current = el!.scrollHeight - el!.scrollTop - el!.clientHeight < threshold;
    }
    updateNearBottom();
    el.addEventListener("scroll", updateNearBottom);
    return () => el.removeEventListener("scroll", updateNearBottom);
  }, []);

  useEffect(() => {
    if (!wasNearBottomRef.current) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  // 입력창 높이를 내용에 맞춰 자동으로 늘립니다(최대 5줄 정도까지, 그 이상은 스크롤).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [text]);

  // 첨부파일이 있는 메시지가 로드/도착할 때마다, 아직 URL을 못 받아온 경로만 골라 signed URL을
  // 발급받습니다(비공개 버킷이라 매번 발급이 필요하고, 1시간 동안 유효합니다).
  useEffect(() => {
    let cancelled = false;
    const missing = [
      ...new Set(messages.filter((m) => m.attachment_path && !attachmentUrls[m.attachment_path]).map((m) => m.attachment_path as string)),
    ];
    if (missing.length === 0) return;
    (async () => {
      const entries = await Promise.all(missing.map(async (p) => [p, await getChatFileSignedUrl(p)] as const));
      if (cancelled) return;
      setAttachmentUrls((prev) => {
        const next = { ...prev };
        for (const [p, url] of entries) if (url) next[p] = url;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // 채팅창이 열려 있고 메시지가 쌓이면(새로 왔든, 처음 불러왔든) "여기까지 읽었다"로 표시합니다.
  // 너무 자주 쓰지 않도록 짧게 쓰로틀만 걸었습니다(메시지 하나하나마다 매번 쓰지 않아도 충분).
  useEffect(() => {
    if (messages.length > 0) markRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, department]);

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("messages")
        .select(
          "id, department, author_email, content, source_department, reply_to_id, edited_at, attachment_path, attachment_name, attachment_type, attachment_size, pinned_at, pinned_by, created_at"
        )
        .eq("department", department)
        .ilike("content", `%${searchQuery.trim()}%`)
        .order("created_at", { ascending: false })
        .limit(30);
      if (!cancelled) {
        setSearchResults((data as ChatMessage[] | null) ?? []);
        setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, searchOpen, department]);

  // @호출 후보에서 공용 계정(도서관·오리엔테이션)을 뺍니다 - 부를 사람이 없는 계정입니다.
  const filteredUsers = realPeople(team).filter((m) => m.name && m.name.includes(mentionFilter)).slice(0, 8);
  const showAllMentionOption = ALL_MENTION.includes(mentionFilter);
  const filteredDepartments = departments.filter((d) => d.name !== department && d.name.includes(hashFilter));
  const deptMembers = realPeople(team).filter((t) => t.email !== userEmail);
  const pinnedMessages = messages
    .filter((m) => m.pinned_at)
    .sort((a, b) => new Date(b.pinned_at as string).getTime() - new Date(a.pinned_at as string).getTime());

  // 내가 보낸 메시지를 아직 안 읽은 부서원 수를 셉니다(카카오톡의 "1" 표시와 같은 개념).
  // 메시지마다 읽음 여부를 저장하지 않고, "이 시각 이후 메시지 = 안 읽음"으로 계산합니다.
  function unreadCountFor(m: ChatMessage) {
    if (m.author_email !== userEmail) return 0;
    const msgTime = new Date(m.created_at).getTime();
    const readCount = deptMembers.filter((t) => {
      const lastRead = reads[t.email];
      return lastRead && new Date(lastRead).getTime() >= msgTime;
    }).length;
    return Math.max(0, deptMembers.length - readCount);
  }

  async function markRead() {
    const now = Date.now();
    if (now - lastMarkReadRef.current < MARK_READ_DEBOUNCE_MS) return;
    lastMarkReadRef.current = now;
    const supabase = createClient();
    const nowIso = new Date().toISOString();
    setReads((prev) => ({ ...prev, [userEmail]: nowIso }));
    await supabase.from("message_reads").upsert({ department, user_email: userEmail, last_read_at: nowIso }, { onConflict: "department,user_email" });
  }

  function broadcastTyping() {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1500) return; // 너무 자주 보내지 않도록 살짝 쓰로틀
    lastTypingSentRef.current = now;
    channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { email: userEmail, name: nameFor(team, userEmail) },
    });
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setText(val);
    if (val.trim()) broadcastTyping();
    const cursor = e.target.selectionStart || 0;
    const before = val.slice(0, cursor);

    const mentionMatch = before.match(/@(\S*)$/);
    if (mentionMatch) {
      setShowMentionMenu(true);
      setMentionFilter(mentionMatch[1]);
      setShowHashMenu(false);
      return;
    }
    setShowMentionMenu(false);

    const hashMatch = before.match(/#(\S*)$/);
    if (hashMatch) {
      setShowHashMenu(true);
      setHashFilter(hashMatch[1]);
    } else {
      setShowHashMenu(false);
    }
  }

  // Enter로 전송, Shift+Enter로 줄바꿈 - 구글챗/슬랙과 동일한 입력 방식입니다. 멘션/부서 메뉴가
  // 떠 있을 때 Enter를 누르면 메뉴 선택으로 우선 쓰는 게 자연스럽지만, 메뉴 항목은 클릭으로도
  // 고를 수 있어 여기서는 항상 전송으로 통일했습니다(에디터마다 동작이 다르면 오히려 헷갈립니다).
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  }

  // 입력창 위 서식 툴바(요청 #8) - 구글독스처럼 버튼을 누르면 선택한 글자를 마크다운 기호로
  // 감쌉니다. 선택한 부분이 없으면 기호만 커서 위치에 넣고 그 사이에 커서를 둡니다.
  function wrapSelection(prefix: string, suffix: string = prefix) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const selected = text.slice(start, end);
    const next = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursorStart = start + prefix.length;
      const cursorEnd = cursorStart + selected.length;
      el.setSelectionRange(cursorStart, cursorEnd);
    });
  }

  function selectToken(value: string, isHash: boolean) {
    if (!textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart || 0;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const newBefore = isHash ? before.replace(/#\S*$/, `#${value} `) : before.replace(/@\S*$/, `@${value} `);
    setText(newBefore + after);
    setShowMentionMenu(false);
    setShowHashMenu(false);
    textareaRef.current.focus();
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    await doSend();
  }

  async function doSend() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setShowMentionMenu(false);
    setShowHashMenu(false);
    const supabase = createClient();
    const replyToId = replyTarget?.id ?? null;

    // 저장이 실패해도(끊긴 와이파이 등) 방금 쓴 내용이 사라지지 않도록, 전송에 성공한 뒤에만
    // 입력창을 비웁니다. try/finally로 감싸서 실패해도 전송 버튼이 영영 잠기지 않게 합니다 -
    // 예전에는 여기서 에러를 확인하지 않아서 실패한 메시지가 조용히 사라질 수 있었습니다.
    try {
      // realtime(postgres_changes) INSERT 이벤트가 오기 전에, 방금 보낸 메시지를 응답받은
      // 그대로 먼저 화면에 붙입니다. 와이파이 상태나 웹소켓 재연결 타이밍에 따라 realtime
      // 이벤트가 몇 초~수십 초씩 늦게 도착할 수 있는데, 그동안 "보낸 메시지가 안 보이는"
      // 것처럼 느껴지던 걸 없앱니다. 나중에 realtime 이벤트가 와도 같은 id면 무시하도록
      // 되어있어(아래 INSERT 구독 핸들러의 prev.some 체크) 중복으로 쌓이지 않습니다.
      const { data: inserted, error } = await supabase
        .from("messages")
        .insert({ department, author_email: userEmail, content, reply_to_id: replyToId })
        .select(
          "id, department, author_email, content, source_department, reply_to_id, edited_at, attachment_path, attachment_name, attachment_type, attachment_size, pinned_at, pinned_by, created_at"
        )
        .single();
      if (error) throw new Error(error.message);
      if (inserted) {
        const row = inserted as ChatMessage;
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      }

      setText("");
      setReplyTarget(null);

      // 예전에는 "@사람" 태그가 있으면 메시지를 곧바로 업무로 자동 등록했는데, 채팅이 실시간으로
      // 활발해지면 태그만 걸린 잡담까지 전부 업무화될 수 있어서 바꿨습니다. 이제는 메시지를 직접
      // 클릭했을 때 뜨는 작은 팝업에서 "업무로 등록"을 눌러야만(그때 AI가 분석) 업무가 됩니다 -
      // 아래 registerAsTask() 참고. @태그는 여전히 하이라이트만 되고, 등록 시 담당자 후보로 쓰입니다.

      // "#부서명" 태그 - 그 부서 채팅방에도 같은 메시지를 그대로 공유합니다. 원본 메시지는 이미
      // 보내졌으니, 이 공유가 실패해도 사용자에게 굳이 알리지 않고 콘솔에만 남깁니다.
      const taggedDepts = extractTaggedDepartments(content, departments, department);
      for (const dept of taggedDepts) {
        const { error: crossError } = await supabase
          .from("messages")
          .insert({ department: dept, author_email: userEmail, content, source_department: department });
        if (crossError) console.error(`#${dept} 채널 공유 실패:`, crossError.message);
      }
    } catch (err) {
      notify(friendlyError("메시지를 보내지 못했습니다.", err), "error");
    } finally {
      setSending(false);
    }
  }

  // 파일을 고르면 바로 업로드하고(입력창에 적어둔 글자가 있으면 함께 캡션으로) 메시지를 보냅니다.
  async function handleAttachmentChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      notify("파일이 너무 큽니다 (최대 20MB).", "error");
      return;
    }
    setUploadingFile(true);
    let uploadedPath: string | null = null;
    try {
      const path = await uploadChatFile(file, department);
      uploadedPath = path;
      const supabase = createClient();
      const content = text.trim();
      const replyToId = replyTarget?.id ?? null;
      const { data: inserted, error } = await supabase
        .from("messages")
        .insert({
          department,
          author_email: userEmail,
          content,
          reply_to_id: replyToId,
          attachment_path: path,
          attachment_name: file.name,
          attachment_type: file.type || null,
          attachment_size: file.size,
        })
        .select(
          "id, department, author_email, content, source_department, reply_to_id, edited_at, attachment_path, attachment_name, attachment_type, attachment_size, pinned_at, pinned_by, created_at"
        )
        .single();
      if (error) throw new Error(error.message);
      if (inserted) {
        const row = inserted as ChatMessage;
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      }
      // 메시지 저장까지 성공한 뒤에만 캡션 입력창을 비웁니다.
      setText("");
      setReplyTarget(null);
    } catch (err) {
      // 파일은 이미 업로드됐는데 메시지 저장이 실패한 경우, 아무도 참조하지 않는 파일이
      // 버킷에 계속 남지 않도록 정리합니다.
      if (uploadedPath) {
        deleteChatFile(uploadedPath).catch(() => {});
      }
      notify(friendlyError("파일을 업로드하지 못했습니다.", err), "error");
    } finally {
      setUploadingFile(false);
    }
  }

  // 잘못 보낸 메시지는 보낸 사람 본인만 지울 수 있습니다(DB의 delete RLS 정책도 author_email이
  // 본인일 때만 허용하도록 맞춰뒀습니다 - 여기 UI 조건은 그 위에 얹는 사용성용 가드입니다).
  async function deleteMessage(m: ChatMessage) {
    if (m.author_email !== userEmail) return;
    if (!(await confirmAction("이 메시지를 삭제할까요? 되돌릴 수 없습니다.", { danger: true }))) return;
    const supabase = createClient();
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    const { error } = await supabase.from("messages").delete().eq("id", m.id);
    if (error) {
      notify(friendlyError("메시지를 삭제하지 못했습니다.", error), "error");
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    }
  }

  function startEdit(m: ChatMessage) {
    setEditingId(m.id);
    setEditText(m.content);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText("");
  }

  async function saveEdit(m: ChatMessage) {
    const content = editText.trim();
    if (!content) return;
    const editedAt = new Date().toISOString();
    const supabase = createClient();
    const { error } = await supabase.from("messages").update({ content, edited_at: editedAt }).eq("id", m.id);
    if (error) {
      notify(friendlyError("수정하지 못했습니다.", error), "error");
      return;
    }
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, content, edited_at: editedAt } : x)));
    setEditingId(null);
    setEditText("");
  }

  // 이모지 반응 - 이미 남긴 반응을 다시 누르면 취소(토글)됩니다.
  async function toggleReaction(messageId: string, emoji: string) {
    setReactionPopup(null);
    const supabase = createClient();
    const existing = reactions.find((r) => r.message_id === messageId && r.emoji === emoji && r.author_email === userEmail);
    if (existing) {
      // 방금 낙관적으로 추가한 반응(아직 서버 insert가 끝나지 않아 임시 id인 상태)을 빠르게
      // 다시 누르면, 그 임시 id로 delete를 보내도 DB에는 매칭되는 행이 없어 아무 효과 없이
      // "취소했다"고만 착각하게 됩니다 - insert가 끝날 때까지는 재클릭을 무시합니다.
      if (existing.id.startsWith("temp-")) return;
      setReactions((prev) => prev.filter((r) => r.id !== existing.id));
      const { error } = await supabase.from("message_reactions").delete().eq("id", existing.id);
      if (error) setReactions((prev) => [...prev, existing]);
      return;
    }
    const tempId = `temp-${Date.now()}`;
    const optimistic: MessageReaction = {
      id: tempId,
      message_id: messageId,
      department,
      emoji,
      author_email: userEmail,
      created_at: new Date().toISOString(),
    };
    setReactions((prev) => [...prev, optimistic]);
    const { data, error } = await supabase
      .from("message_reactions")
      .insert({ message_id: messageId, department, emoji, author_email: userEmail })
      .select()
      .single();
    if (error) {
      setReactions((prev) => prev.filter((r) => r.id !== tempId));
    } else if (data) {
      setReactions((prev) => prev.map((r) => (r.id === tempId ? (data as MessageReaction) : r)));
    }
  }

  // 고정/해제는 누구나 할 수 있습니다(카카오톡 공지처럼) - DB 쪽에서도 pinned_at/pinned_by만
  // 예외로 열어두고 나머지 컬럼(글자 내용 등)은 여전히 작성자만 바꿀 수 있게 트리거로 막아뒀습니다.
  async function togglePin(m: ChatMessage) {
    const supabase = createClient();
    const wasPinned = !!m.pinned_at;
    const patch = wasPinned ? { pinned_at: null, pinned_by: null } : { pinned_at: new Date().toISOString(), pinned_by: userEmail };
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("messages").update(patch).eq("id", m.id);
    if (error) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      notify(friendlyError((wasPinned ? "고정을 해제하지" : "고정하지") + " 못했습니다.", error), "error");
    }
  }

  function scrollToMessage(id: string) {
    const el = messageRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1500);
  }

  // 검색 결과를 누르면 그 메시지로 이동합니다. 최근 100개 안에 이미 불러와져 있으면 바로
  // 스크롤하고, 그보다 오래된 메시지면 목록에 시간 순서대로 끼워 넣은 뒤 이동합니다(그 사이
  // 메시지들이 통째로 로드되는 건 아니라서 위아래에 약간의 시간 간격이 보일 수 있습니다).
  async function jumpToMessage(m: ChatMessage) {
    setSearchOpen(false);
    setSearchQuery("");
    const alreadyLoaded = messages.some((x) => x.id === m.id);
    if (!alreadyLoaded) {
      setMessages((prev) => [...prev, m].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
      const supabase = createClient();
      const { data } = await supabase
        .from("message_reactions")
        .select("id, message_id, department, emoji, author_email, created_at")
        .eq("message_id", m.id);
      if (data && data.length) {
        setReactions((prev) => [...prev, ...(data as MessageReaction[]).filter((r) => !prev.some((p) => p.id === r.id))]);
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToMessage(m.id)));
  }

  const REACTION_POPUP_WIDTH = 216;
  function openReactionPopup(e: React.MouseEvent, messageId: string) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setReactionPopup({ messageId, top: rect.bottom + 4, left: Math.max(4, rect.left - REACTION_POPUP_WIDTH + 24) });
  }

  // 아래에 뜨면 바로 다음 메시지를 가려버려서, 메시지 오른쪽 옆에 작게 붙도록 위치를 잡습니다.
  // 오른쪽에 공간이 부족하면(채팅창을 좁게 줄인 경우) 자동으로 왼쪽에 붙습니다.
  const TASK_POPUP_WIDTH = 100;
  function openTaskPopup(e: React.MouseEvent, m: ChatMessage) {
    if (isSystemMsg(m.content)) return; // 등록 안내 메시지는 다시 등록할 필요 없음
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const spaceRight = window.innerWidth - rect.right;
    const left = spaceRight >= TASK_POPUP_WIDTH + 8 ? rect.right + 6 : Math.max(4, rect.left - TASK_POPUP_WIDTH - 6);
    setRegisterError(null);
    setTaskPopup({ message: m, top: rect.top, left });
  }

  // 팝업에서 "업무로 등록"을 누르면 이 메시지 한 건만 AI에게 보내 제목/담당자/마감일/우선순위를
  // 뽑아내 업무로 등록합니다. AI 호출이 실패해도(네트워크 오류 등) 기존 규칙 기반 파서
  // (parseTaskFromMessage)로 대체해서 등록 자체는 항상 되도록 했습니다.
  async function registerAsTask(m: ChatMessage) {
    setAnalyzing(true);
    setRegisterError(null);
    const supabase = createClient();
    let title: string;
    let assigneeEmails: string[];
    let dueAt: string | null;
    let priority: "보통" | "긴급" = "보통";
    let aiFailed = false;

    try {
      const res = await fetch("/api/ai/analyze-task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: m.content, teamNames: realPeople(team).filter((t) => t.name).map((t) => t.name) }),
      });
      const data = await res.json();
      if (!res.ok || !data.result) throw new Error(data.error || "AI 분석 실패");
      title = String(data.result.title || m.content).slice(0, 80);
      const namesSet = new Set<string>(data.result.assigneeNames || []);
      assigneeEmails = realPeople(team).filter((t) => t.name && namesSet.has(t.name)).map((t) => t.email);
      if (assigneeEmails.length === 0) assigneeEmails = extractMentionedEmails(m.content, team);
      dueAt = data.result.dueDate ? new Date(`${data.result.dueDate}T23:59:59`).toISOString() : null;
      priority = data.result.priority === "긴급" ? "긴급" : "보통";
    } catch {
      aiFailed = true;
      const parsed = parseTaskFromMessage(m.content);
      title = parsed.cleanTitle.slice(0, 80);
      assigneeEmails = extractMentionedEmails(m.content, team);
      dueAt = parsed.dueAt;
    }

    // 이 아래(실제 DB 저장)에서 실패하면 예전에는 조용히 아무 일도 없었던 것처럼 팝업만 닫혀서
    // "눌렀는데 등록이 안 된다"는 게 겉으로 전혀 드러나지 않았습니다. try/catch로 감싸고 error를
    // 반드시 확인해서, 실패하면 팝업을 닫지 않고 이유를 보여주고 다시 시도할 수 있게 했습니다.
    try {
      const { data: newTask, error: taskError } = await supabase
        .from("tasks")
        .insert({
          case_id: genCaseId("TSK"),
          title,
          description: m.content,
          status: "예정",
          priority,
          department,
          owner_email: userEmail,
          assignee_emails: assigneeEmails,
          due_at: dueAt,
          position: Date.now(),
        })
        .select()
        .single();

      if (taskError || !newTask) {
        throw new Error(taskError?.message || "업무를 저장하지 못했습니다.");
      }

      onTaskCreated?.(newTask as Task);
      const assigneeLabel = assigneeEmails.length > 0 ? `${assigneeEmails.map((e) => nameFor(team, e)).join(", ")}님` : "담당자 미지정";
      const dl = deadlineLabel(dueAt);
      const deadlineSuffix = dl ? ` (${dl})` : "";
      const aiNote = aiFailed ? " ⚠️AI 분석 실패로 기본 규칙 사용" : " (AI 분석)";
      // 예전에는 이 확인 메시지를 채팅(messages)에 남겨서 대화가 시스템 알림으로 섞여 보였는데,
      // 이제는 다른 업무 확인/상태변경 이벤트와 같은 자리(task_comments, is_system=true)에
      // 남겨서 업무상황판 오른쪽 "🔔 실시간 로그"에서만 보이고 채팅창은 항상 대화만 깔끔하게
      // 남도록 했습니다(요청).
      const { error: logError } = await supabase.from("task_comments").insert({
        task_id: newTask.id,
        author_email: userEmail,
        content: `✅ 업무로 등록됨${aiNote} → ${assigneeLabel}: "${newTask.title}"${deadlineSuffix}`,
        department,
        is_system: true,
      });
      if (logError) console.error("업무등록 로그 기록 실패:", logError);

      setTaskPopup(null);
    } catch (err) {
      setRegisterError(friendlyError("업무를 등록하지 못했습니다.", err));
    } finally {
      setAnalyzing(false);
    }
  }

  const deptColor = departments.find((d) => d.name === department)?.color || "#3b82f6";
  const typingNames = Object.values(typingUsers).map((t) => t.name);

  return (
    <div className="glass-panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2 text-[13px] font-bold">
        <span className="shrink-0" style={{ color: deptColor }}>👥</span>
        <span className="min-w-0 truncate whitespace-nowrap">[{department}] 부서 그룹 채팅방</span>
        <span className="hidden shrink-0 whitespace-nowrap text-[11px] font-normal opacity-60 md:inline">({department} 부서원 전원이 참여 중입니다)</span>
        <button
          type="button"
          onClick={() => setSearchOpen((v) => !v)}
          title="메시지 검색"
          className={"ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs hover:bg-black/5 " + (searchOpen ? "bg-black/10" : "")}
        >
          🔍
        </button>
        <span
          className={
            "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold " +
            (connected ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")
          }
          title={connected ? "실시간 연결됨" : "연결이 끊겨 재연결을 시도하는 중입니다"}
        >
          <span className={"h-1.5 w-1.5 rounded-full " + (connected ? "bg-emerald-500" : "animate-pulse bg-amber-500")} />
          <span className="hidden sm:inline">{connected ? "실시간 연결됨" : "재연결 중..."}</span>
        </span>
      </div>

      {searchOpen && (
        <div className="border-b border-black/5 bg-white/70 p-2">
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="메시지 검색..."
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none"
          />
          {searchQuery.trim() && (
            <div className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-slate-100">
              {searching && <div className="p-2 text-center text-[11px] opacity-40">검색 중...</div>}
              {!searching && searchResults.length === 0 && <div className="p-2 text-center text-[11px] opacity-40">검색 결과가 없습니다.</div>}
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => jumpToMessage(r)}
                  className="flex w-full flex-col gap-0.5 border-b border-slate-50 px-2.5 py-1.5 text-left text-[11px] last:border-0 hover:bg-slate-50"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="font-semibold">{nameFor(team, r.author_email)}</span>
                    <span className="opacity-40">{timeStr(r.created_at)}</span>
                  </span>
                  <span className="truncate opacity-70">{oneLine(r.content, 70)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pinnedMessages.length > 0 && (
        <div className="border-b border-black/5 bg-amber-50/60 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setPinnedOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 text-[11px] font-semibold text-amber-700"
          >
            <span>📌 고정된 메시지 {pinnedMessages.length}개</span>
            <span className="ml-auto">{pinnedOpen ? "▲" : "▼"}</span>
          </button>
          {pinnedOpen && (
            <div className="mt-1 flex flex-col gap-1">
              {pinnedMessages.map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-md bg-white/70 px-2 py-1 text-[11px]">
                  <button type="button" onClick={() => scrollToMessage(m.id)} className="min-w-0 flex-1 truncate text-left hover:underline">
                    <span className="font-semibold">{nameFor(team, m.author_email)}</span>: {oneLine(m.content, 60)}
                  </button>
                  <button type="button" onClick={() => togglePin(m)} title="고정 해제" className="shrink-0 text-slate-400 hover:text-red-500">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && <p className="text-xs opacity-40">아직 메시지가 없습니다. 첫 메시지를 남겨보세요.</p>}
        <div className="flex flex-col gap-3">
          {messages.map((m, idx) => {
            const linkedTask = tasks.find((t) => t.title === m.content.match(/"([^"]+)"/)?.[1]);
            const isSystemConfirmation = isSystemMsg(m.content);
            const isMine = m.author_email === userEmail;
            const prevMsg = messages[idx - 1];
            const grouped =
              !!prevMsg &&
              !m.reply_to_id &&
              prevMsg.author_email === m.author_email &&
              !isSystemMsg(prevMsg.content) &&
              !isSystemConfirmation &&
              new Date(m.created_at).getTime() - new Date(prevMsg.created_at).getTime() < GROUP_WINDOW_MS;
            const quoted = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
            const msgReactions = reactions.filter((r) => r.message_id === m.id);
            const reactionGroups = REACTION_EMOJIS.map((emoji) => ({
              emoji,
              emails: msgReactions.filter((r) => r.emoji === emoji).map((r) => r.author_email),
            })).filter((g) => g.emails.length > 0);
            const isEditing = editingId === m.id;
            const linkUrl = !m.attachment_path ? firstUrlIn(m.content) : null;
            const unread = unreadCountFor(m);

            return (
              <div
                key={m.id}
                ref={(el) => {
                  messageRefs.current[m.id] = el;
                }}
                className={
                  "group flex gap-2 rounded-lg transition " +
                  (grouped ? "mt-[-6px] " : "") +
                  (highlightId === m.id
                    ? "bg-amber-100/60 ring-2 ring-amber-300"
                    : m.content.includes(`@${ALL_MENTION}`)
                      ? "bg-amber-50/70 ring-1 ring-amber-200"
                      : "")
                }
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center">
                  {!grouped && <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm">👤</div>}
                </div>
                <div className="min-w-0 flex-1">
                  {!grouped && (
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <span className="text-sm font-semibold">{nameFor(team, m.author_email)}</span>
                      <span className="text-[11px] opacity-50">{timeStr(m.created_at)}</span>
                      {isMine && !isSystemConfirmation && unread > 0 && <span className="text-[10px] font-semibold text-amber-500">{unread}</span>}
                      {linkedTask && (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                          💼 업무 ({linkedTask.acknowledged_by?.filter((a) => ackRequiredEmails(linkedTask).includes(a.email)).length ?? 0}/{ackRequiredEmails(linkedTask).length})
                        </span>
                      )}
                      {m.pinned_at && (
                        <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-700">📌 고정됨</span>
                      )}
                    </div>
                  )}
                  {m.source_department && <div className="mt-0.5 text-[10px] font-medium text-indigo-500">🔁 {m.source_department}에서 공유됨</div>}

                  {isEditing ? (
                    <div className="mt-1">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            saveEdit(m);
                          } else if (e.key === "Escape") {
                            cancelEdit();
                          }
                        }}
                        autoFocus
                        rows={2}
                        className="w-full rounded-lg border border-blue-300 bg-white px-2 py-1.5 text-[13px] outline-none"
                      />
                      <div className="mt-1 flex gap-2">
                        <button
                          onClick={() => saveEdit(m)}
                          className="rounded-md bg-blue-500 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-blue-600"
                        >
                          저장
                        </button>
                        <button onClick={cancelEdit} className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-black/5">
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-end gap-1">
                      <div
                        onClick={(e) => !isSystemConfirmation && openTaskPopup(e, m)}
                        title={isSystemConfirmation ? undefined : "클릭하면 이 메시지를 업무로 등록할 수 있어요"}
                        className={
                          "glass inline-block max-w-full rounded-tl-none px-3 py-1.5 text-[13px] leading-relaxed transition " +
                          (isSystemConfirmation ? "" : "cursor-pointer hover:brightness-95")
                        }
                      >
                        {quoted && (
                          <div className="mb-1 rounded border-l-2 border-slate-300 bg-black/5 px-2 py-1 text-[11px] opacity-70">
                            <span className="font-semibold">{nameFor(team, quoted.author_email)}</span>: {oneLine(quoted.content)}
                          </div>
                        )}
                        {!quoted && m.reply_to_id && (
                          <div className="mb-1 rounded border-l-2 border-slate-300 bg-black/5 px-2 py-1 text-[11px] italic opacity-50">
                            (원본 메시지를 찾을 수 없음)
                          </div>
                        )}
                        {m.content && renderMessageText(m.content, departments)}
                        {m.edited_at && <span className="ml-1 text-[10px] opacity-40">(수정됨)</span>}

                        {m.attachment_path && (
                          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                            {m.attachment_type?.startsWith("image/") ? (
                              attachmentUrls[m.attachment_path] ? (
                                <a href={attachmentUrls[m.attachment_path]} target="_blank" rel="noopener noreferrer">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={attachmentUrls[m.attachment_path]}
                                    alt={m.attachment_name ?? "첨부 이미지"}
                                    className="max-h-52 max-w-full rounded-lg object-contain"
                                  />
                                </a>
                              ) : (
                                <div className="flex h-20 w-32 items-center justify-center rounded-lg bg-black/5 text-[10px] opacity-50">
                                  불러오는 중...
                                </div>
                              )
                            ) : (
                              <a
                                href={attachmentUrls[m.attachment_path] || "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 g-panel-solid px-2.5 py-1.5 text-[11px] hover:bg-slate-50"
                              >
                                <span>📎</span>
                                <span className="min-w-0 max-w-[160px] truncate font-medium text-slate-700">{m.attachment_name}</span>
                                {m.attachment_size != null && (
                                  <span className="shrink-0 text-slate-400">{formatFileSize(m.attachment_size)}</span>
                                )}
                              </a>
                            )}
                          </div>
                        )}

                        {linkUrl && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <LinkPreviewCard url={linkUrl} />
                          </div>
                        )}
                      </div>

                      {!isSystemConfirmation && (
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                          {/* 호버 시 바로 보이는 "→업무" 버튼(커맨드센터 개편): 메시지를 클릭해야
                              뜨던 업무 등록 팝업을 눈에 띄는 액션으로 꺼냈습니다(Slack의
                              메시지→태스크 패턴). 동작은 기존 클릭 팝업과 동일합니다. */}
                          {!linkedTask && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openTaskPopup(e, m);
                              }}
                              title="이 메시지를 업무로 등록"
                              className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600 hover:bg-blue-100"
                            >
                              →업무
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => openReactionPopup(e, m.id)}
                            title="반응 남기기"
                            className="rounded px-1 py-0.5 text-[13px] hover:bg-black/5"
                          >
                            😀
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReplyTarget(m);
                              textareaRef.current?.focus();
                            }}
                            title="답장"
                            className="rounded px-1 py-0.5 text-[13px] hover:bg-black/5"
                          >
                            ↩️
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePin(m);
                            }}
                            title={m.pinned_at ? "고정 해제" : "고정"}
                            className="rounded px-1 py-0.5 text-[13px] hover:bg-black/5"
                          >
                            📌
                          </button>
                          {isMine && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                startEdit(m);
                              }}
                              title="수정"
                              className="rounded px-1 py-0.5 text-[13px] hover:bg-black/5"
                            >
                              ✏️
                            </button>
                          )}
                          {isMine && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteMessage(m);
                              }}
                              title="삭제"
                              className="rounded px-1 py-0.5 text-[13px] font-bold text-red-500 hover:bg-red-50"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {reactionGroups.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {reactionGroups.map((g) => (
                        <button
                          key={g.emoji}
                          onClick={() => toggleReaction(m.id, g.emoji)}
                          title={g.emails.map((e) => nameFor(team, e)).join(", ")}
                          className={
                            "flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] transition " +
                            (g.emails.includes(userEmail) ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white/60 hover:bg-black/5")
                          }
                        >
                          <span>{g.emoji}</span>
                          <span className="text-[10px] opacity-70">{g.emails.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative border-t border-black/5 p-2.5">
        {typingNames.length > 0 && (
          <div className="px-1 pb-1 text-[11px] italic opacity-50">{typingNames.join(", ")}님이 입력 중...</div>
        )}

        {replyTarget && (
          <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-slate-200 bg-black/[0.03] px-2.5 py-1.5 text-[11px]">
            <span className="opacity-50">↩️ 답장</span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold">{nameFor(team, replyTarget.author_email)}</span>: {oneLine(replyTarget.content, 50)}
            </span>
            <button type="button" onClick={() => setReplyTarget(null)} className="shrink-0 rounded px-1 font-bold opacity-50 hover:bg-black/5">
              ✕
            </button>
          </div>
        )}

        {showMentionMenu && (filteredUsers.length > 0 || showAllMentionOption) && (
          <div className="glass absolute bottom-full left-2.5 z-20 mb-1.5 max-h-48 w-56 overflow-y-auto p-1.5">
            <div className="px-2 py-1 text-[11px] opacity-60">개인/전체 호출 (@)</div>
            {showAllMentionOption && (
              <button
                type="button"
                onClick={() => selectToken(ALL_MENTION, false)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-amber-50"
              >
                <span className="font-bold text-amber-600">📢 전체</span>
                <span className="text-[11px] opacity-60">부서원 전체 호출</span>
              </button>
            )}
            {filteredUsers.map((u) => (
              <button
                key={u.email}
                type="button"
                onClick={() => selectToken(u.name || u.email, false)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-blue-50"
              >
                <span className="font-semibold">{u.name}</span>
              </button>
            ))}
          </div>
        )}
        {showHashMenu && filteredDepartments.length > 0 && (
          <div className="glass absolute bottom-full left-2.5 z-20 mb-1.5 max-h-48 w-56 overflow-y-auto p-1.5">
            <div className="px-2 py-1 text-[11px] opacity-60">단체/부서 공지 (#)</div>
            {filteredDepartments.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => selectToken(d.name, true)}
                style={{ color: d.color }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-black/5"
              >
                <span className="font-semibold">{d.name}</span>
                <span className="text-[11px] opacity-60">전체 알림</span>
              </button>
            ))}
          </div>
        )}

        {/* 구글독스 메뉴처럼 선택한 글자를 감싸는 간단한 서식 툴바입니다(요청 #8, 아이콘화 요청
            반영) - 굵게/기울임/취소선/코드 4개만 지원해도 채팅에서 쓰기엔 충분하고, 결과는
            기존에 지원하던 마크다운 문법(**굵게** 등)과 같은 문자열이라 렌더링 쪽 코드를 새로
            만들 필요가 없습니다. 글자(B/I/S) 대신 선으로 그린 작은 아이콘을 씁니다. */}
        <div className="mb-1.5 flex items-center gap-0.5">
          <button type="button" onClick={() => wrapSelection("**")} title="굵게" className="rounded p-1 text-slate-500 hover:bg-black/5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4h8a4 4 0 0 1 0 8H6z" />
              <path d="M6 12h9a4 4 0 0 1 0 8H6z" />
            </svg>
          </button>
          <button type="button" onClick={() => wrapSelection("*")} title="기울임" className="rounded p-1 text-slate-500 hover:bg-black/5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="4" x2="10" y2="4" />
              <line x1="14" y1="20" x2="5" y2="20" />
              <line x1="15" y1="4" x2="9" y2="20" />
            </svg>
          </button>
          <button type="button" onClick={() => wrapSelection("~~")} title="취소선" className="rounded p-1 text-slate-500 hover:bg-black/5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 12h12" />
              <path d="M8 6.5c0-1.5 1.8-2.5 4-2.5s4 1 4 2.5" />
              <path d="M8 17.5c0 1.5 1.8 2.5 4 2.5s4-1 4-2.5" />
            </svg>
          </button>
          <button type="button" onClick={() => wrapSelection("`")} title="코드" className="rounded p-1 text-slate-500 hover:bg-black/5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="8 6 3 12 8 18" />
              <polyline points="16 6 21 12 16 18" />
            </svg>
          </button>
        </div>

        <form onSubmit={sendMessage} className="flex items-end gap-2 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2">
          <input ref={fileInputRef} type="file" onChange={handleAttachmentChange} disabled={uploadingFile} className="hidden" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingFile}
            title="파일 첨부"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-black/5 disabled:opacity-50"
          >
            {uploadingFile ? "…" : "📎"}
          </button>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="메시지 보내기 (Enter 전송·Shift+Enter 줄바꿈, @개인호출·@전체, #부서공지)"
            rows={1}
            className="min-w-0 flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white transition hover:bg-blue-600 disabled:opacity-50"
          >
            ➤
          </button>
        </form>
      </div>

      {/* 메시지를 클릭하면 뜨는 작은 "업무등록" 팝업 - 채팅 말풍선(.glass, 13px) 바로 옆에
          붙는 아주 작은 컨트롤이라, 다음 메시지를 가리지 않도록 아래가 아니라 옆으로 띄우고,
          글씨도 더 작게(11px) 만들어서 말풍선과 한눈에 구별되도록 했습니다. 사이드바 부메뉴/
          업무상황판과 같은 포탈 패턴이라 overflow-y-auto에 잘리지 않고 항상 위에 떠서 나옵니다. */}
      {taskPopup &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => !analyzing && setTaskPopup(null)} />
            <div
              style={{ position: "fixed", top: taskPopup.top, left: taskPopup.left, width: registerError ? 200 : TASK_POPUP_WIDTH }}
              className="z-50 g-panel-solid p-1 shadow-lg"
            >
              {analyzing ? (
                <div className="px-1.5 py-1 text-center text-[10px] text-slate-400">분석 중…</div>
              ) : registerError ? (
                <div className="p-1">
                  <div className="mb-1 text-[10px] leading-snug text-red-600">⚠️ {registerError}</div>
                  <button
                    onClick={() => registerAsTask(taskPopup.message)}
                    className="flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-blue-600 hover:bg-blue-50"
                  >
                    다시 시도
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => registerAsTask(taskPopup.message)}
                  className="flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-blue-600 hover:bg-blue-50"
                >
                  📋 업무등록
                </button>
              )}
            </div>
          </>,
          document.body
        )}

      {/* 이모지 반응 고르기 팝업 - 업무등록 팝업과 같은 포탈 패턴입니다. */}
      {reactionPopup &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setReactionPopup(null)} />
            <div
              style={{ position: "fixed", top: reactionPopup.top, left: reactionPopup.left, width: REACTION_POPUP_WIDTH }}
              className="z-50 flex flex-wrap gap-1 g-panel-solid p-1.5 shadow-lg"
            >
              {REACTION_EMOJIS.map((emoji) => {
                // 내가 이미 이 이모지로 반응했다면 체크 표시를 겹쳐서 바로 알아볼 수 있게 합니다.
                const mine = reactions.some(
                  (r) => r.message_id === reactionPopup.messageId && r.emoji === emoji && r.author_email === userEmail
                );
                return (
                  <button
                    key={emoji}
                    onClick={() => toggleReaction(reactionPopup.messageId, emoji)}
                    title={mine ? "반응 취소" : "반응 남기기"}
                    className={
                      "relative flex h-7 w-7 items-center justify-center rounded-md text-base transition " +
                      (mine ? "bg-blue-100" : "hover:bg-black/5")
                    }
                  >
                    {emoji}
                    {mine && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-blue-500 text-[7px] text-white">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
