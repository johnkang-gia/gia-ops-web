"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadMeetingAudio } from "@/lib/storage";
import { genCaseId } from "@/lib/caseId";
import type { Meeting } from "@/lib/types";

type ChatTurn = { role: "user" | "assistant"; content: string };
type Draft = { date: string; attendees: string; organizedContent: string };

// 라이브 녹음은 이 길이(약 60초)마다 녹음을 끊고 재시작하면서, 그 구간만 바로 텍스트로 바꿔
// 채팅에 자동으로 보냅니다(진짜 실시간 스트리밍은 아니지만, 이 정도 지연으로도 회의가 진행되는
// 동안 정리본이 계속 갱신되는 것을 볼 수 있습니다). 너무 짧게 끊으면 문장 중간이 잘려서
// 인식률이 떨어지므로, 30초보다는 다소 길게 잡았습니다.
const LIVE_CHUNK_MS = 60000;

// 브라우저가 지원하는 것 중 음질이 가장 좋은 녹음 형식을 고릅니다. 기본값(브라우저가 알아서
// 고르는 저음질 opus)보다 비트레이트를 높이면 인식률에 도움이 됩니다.
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function MeetingChatComposer({
  onSaved,
  onCancel,
}: {
  onSaved: (meeting: Meeting) => void;
  onCancel: () => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<Draft>({
    date: new Date().toISOString().slice(0, 10),
    attendees: "",
    organizedContent: "",
  });
  const [readyToSave, setReadyToSave] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [liveRecording, setLiveRecording] = useState(false);
  const [liveElapsedSec, setLiveElapsedSec] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const liveRecordingRef = useRef(false);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const segmentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processingChainRef = useRef<Promise<void>>(Promise.resolve());
  // 라이브 녹음 중에는 recordNextSegment가 자기 자신을 재귀 호출하면서 처음 클릭했을 때의
  // 클로저를 계속 쓰게 되므로, turns/draft/sending을 state가 아니라 ref로도 함께 들고 있어야
  // 나중 세그먼트가 그 사이에 쌓인 최신 대화 내용을 놓치지 않습니다(React state는 오래된 값을
  // 참조할 수 있음 - stale closure 문제).
  const turnsRef = useRef<ChatTurn[]>(turns);
  const draftRef = useRef<Draft>(draft);
  const sendingRef = useRef(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    // 컴포넌트가 닫히거나 언마운트될 때 마이크가 계속 켜져 있지 않도록 정리합니다.
    return () => {
      liveRecordingRef.current = false;
      if (segmentTimeoutRef.current) clearTimeout(segmentTimeoutRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || sendingRef.current) return;
    const nextTurns = [...turnsRef.current, { role: "user" as const, content }];
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
    setInput("");
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/ai/meeting-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turns: nextTurns, currentDraft: draftRef.current }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "AI 응답을 받지 못했습니다.");
        sendingRef.current = false;
        setSending(false);
        return;
      }
      const result = data.result as {
        reply: string;
        date: string;
        attendees: string;
        organizedContent: string;
        readyToSave: boolean;
      };
      const withReply = [...nextTurns, { role: "assistant" as const, content: result.reply }];
      turnsRef.current = withReply;
      setTurns(withReply);
      const nextDraft = {
        date: result.date || draftRef.current.date,
        attendees: result.attendees || draftRef.current.attendees,
        organizedContent: result.organizedContent || draftRef.current.organizedContent,
      };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      setReadyToSave(!!result.readyToSave);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
    sendingRef.current = false;
    setSending(false);
  }

  async function handleAudioFile(file: File) {
    setUploadingAudio(true);
    setError("");
    try {
      const path = await uploadMeetingAudio(file, "meetings");
      setAudioPath(path);
      const res = await fetch("/api/ai/transcribe-audio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      setUploadingAudio(false);
      if (!res.ok) {
        setError(data.error || "음성을 텍스트로 바꾸지 못했습니다.");
        return;
      }
      await sendMessage(data.text);
    } catch (err) {
      setUploadingAudio(false);
      setError(err instanceof Error ? err.message : "음성 파일 업로드에 실패했습니다.");
    }
  }

  function queueSegment(blob: Blob) {
    // 세그먼트 전사·정리는 순서대로 처리하되(먼저 말한 내용이 먼저 반영되도록), 녹음 자체는
    // 이 처리를 기다리지 않고 계속 이어집니다.
    processingChainRef.current = processingChainRef.current.then(async () => {
      try {
        const form = new FormData();
        form.append("file", blob, "segment.webm");
        const res = await fetch("/api/ai/transcribe-live-chunk", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "음성 인식에 실패했습니다.");
          return;
        }
        const text = String(data.text || "").trim();
        if (text) {
          await sendMessage(text);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "음성 인식 중 오류가 발생했습니다.");
      }
    });
  }

  function recordNextSegment() {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 128000, // 기본값보다 높여서 음질을 개선(인식률에 도움)
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      // 아직 회의가 진행 중이면(사용자가 종료를 누르지 않았으면) 끊김 없이 바로 다음 구간 녹음을
      // 시작하고, 방금 끝난 구간은 백그라운드로 전사/정리합니다.
      if (liveRecordingRef.current) {
        recordNextSegment();
      }
      if (blob.size > 1000) {
        queueSegment(blob);
      }
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    segmentTimeoutRef.current = setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, LIVE_CHUNK_MS);
  }

  async function startLive() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      mediaStreamRef.current = stream;
      liveRecordingRef.current = true;
      setLiveRecording(true);
      setLiveElapsedSec(0);
      elapsedTimerRef.current = setInterval(() => setLiveElapsedSec((s) => s + 1), 1000);
      recordNextSegment();
    } catch {
      setError("마이크 접근 권한이 필요합니다. 브라우저에서 마이크 권한을 허용해주세요.");
    }
  }

  function stopLive() {
    liveRecordingRef.current = false;
    setLiveRecording(false);
    if (segmentTimeoutRef.current) clearTimeout(segmentTimeoutRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }

  async function handleSave() {
    if (!draft.organizedContent.trim()) {
      setError("아직 저장할 내용이 없습니다. 먼저 회의 내용을 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("meetings")
      .insert({
        case_id: genCaseId("MTG"),
        date: draft.date || new Date().toISOString().slice(0, 10),
        attendees: draft.attendees,
        content: draft.organizedContent,
        status: "",
        next_agenda: "",
        final_record: "",
        source_chat: turns,
        audio_path: audioPath,
      })
      .select()
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (data) onSaved(data as Meeting);
  }

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">💬 채팅으로 회의록 작성</h2>
        <div className="flex items-center gap-2">
          {liveRecording && (
            <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              REC {formatElapsed(liveElapsedSec)}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (liveRecording) stopLive();
              onCancel();
            }}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            닫기
          </button>
        </div>
      </div>

      {turns.length === 0 && !liveRecording && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          두서없이 적은 회의 메모를 그대로 붙여넣으세요. AI가 애매한 부분은 되물어가며 정식
          회의록으로 정리해 드립니다. 회의를 녹음한 파일을 올리거나, 아래 &quot;회의 시작&quot;을
          눌러 회의를 진행하면서 실시간으로 녹음·정리할 수도 있습니다.
        </p>
      )}
      {liveRecording && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          회의를 녹음하고 있어요. 약 60초 단위로 자동으로 텍스트로 바꿔서 정리본에 반영합니다.
          끝나면 &quot;회의 종료&quot;를 누르세요. 그 사이에도 채팅으로 직접 메모를 추가할 수
          있습니다. 인식률을 높이려면 발언자와 마이크(휴대폰/노트북)를 너무 멀리 두지 말고,
          여러 명이 동시에 말하지 않도록 해주세요.
        </p>
      )}

      {turns.length > 0 && (
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
          {turns.map((t, i) => (
            <div
              key={i}
              className={
                "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm " +
                (t.role === "user"
                  ? "self-end bg-slate-900 text-white"
                  : "self-start bg-white text-slate-700 shadow-sm")
              }
            >
              {t.content}
            </div>
          ))}
          {sending && (
            <div className="self-start rounded-lg bg-white px-3 py-2 text-sm text-slate-400 shadow-sm">
              AI가 정리하는 중...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      )}

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage(input);
            }
          }}
          rows={3}
          placeholder={turns.length === 0 ? "여기에 회의 메모를 붙여넣으세요..." : "답변을 입력하세요..."}
          className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={sending || !input.trim()}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            전송
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAudio || sending || liveRecording}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {uploadingAudio ? "변환 중..." : "🎙️ 음성 파일"}
          </button>
          <button
            type="button"
            onClick={liveRecording ? stopLive : startLive}
            className={
              "rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 " +
              (liveRecording
                ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
                : "border-slate-300 text-slate-600 hover:bg-slate-50")
            }
          >
            {liveRecording ? "⏹️ 회의 종료" : "🔴 회의 시작"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAudioFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {draft.organizedContent && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-semibold text-blue-800">📝 정리 중인 회의록</span>
            <span
              className={
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                (readyToSave ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")
              }
            >
              {readyToSave ? "✅ 저장 준비됨" : "💬 정리 중"}
            </span>
          </div>
          <div className="mb-1 text-blue-700">
            날짜: {draft.date || "(미정)"} · 참석자: {draft.attendees || "(미정)"}
          </div>
          <p className="whitespace-pre-wrap text-slate-700">{draft.organizedContent}</p>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || liveRecording || !draft.organizedContent.trim()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? "저장 중..." : liveRecording ? "회의를 먼저 종료하세요" : "회의록으로 저장"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (liveRecording) stopLive();
            onCancel();
          }}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          취소
        </button>
      </div>
    </div>
  );
}
