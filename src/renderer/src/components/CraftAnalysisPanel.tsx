import { useEffect, useState } from 'react';
import { AlertTriangle, Clapperboard, FolderOpen, Loader2, Play, Sparkles } from 'lucide-react';
import type { AnalysisProgress, AnalysisResult } from '../../../shared/analysisTypes';

export function CraftAnalysisPanel() {
  const [open, setOpen] = useState(false);
  const [videoPath, setVideoPath] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [confirmDownload, setConfirmDownload] = useState(false);
  const [craftDir, setCraftDir] = useState('');
  const [outputBaseDir, setOutputBaseDir] = useState('');
  const [allowVision, setAllowVision] = useState(false);
  const [maxApiCalls, setMaxApiCalls] = useState(100);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const onProgress = (next: AnalysisProgress) => setProgress(next);
    window.api.onCraftAnalysisProgress(onProgress);
    return () => window.api.offCraftAnalysisProgress(onProgress);
  }, []);

  useEffect(() => {
    if (!open || outputBaseDir) return;
    window.api.getDefaultAnalysisOutputDirectory()
      .then(setOutputBaseDir)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [open, outputBaseDir]);

  const pick = async (kind: 'video' | 'craft' | 'output') => {
    setError('');
    try {
      const selected = kind === 'video'
        ? await window.api.pickAnalysisVideo()
        : kind === 'craft'
          ? await window.api.pickAnalysisCraftDirectory()
          : await window.api.pickAnalysisOutputDirectory();
      if (!selected) return;
      if (kind === 'video') { setVideoPath(selected); setVideoUrl(''); setConfirmDownload(false); }
      else if (kind === 'craft') setCraftDir(selected);
      else setOutputBaseDir(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const run = async () => {
    setRunning(true);
    setError('');
    setResult(null);
    setProgress(null);
    try {
      const completed = await window.api.startCraftAnalysis({ videoPath: videoUrl ? undefined : videoPath, videoUrl: videoUrl || undefined, confirmDownload, craftDir, outputBaseDir, allowVision, maxApiCalls });
      setResult(completed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  const picker = (label: string, value: string, kind: 'video' | 'craft' | 'output') => (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-gray-300">{label}</span>
      <div className="flex gap-2">
        <input readOnly value={value} placeholder="선택하세요" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-xs text-gray-300" />
        <button type="button" onClick={() => void pick(kind)} disabled={running} className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs hover:bg-white/10 disabled:opacity-50"><FolderOpen size={14} />찾기</button>
      </div>
    </div>
  );

  return (
    <div className="fixed right-28 top-4 z-50">
      <button type="button" onClick={() => setOpen(true)} title="레퍼런스 영상 분석" className="rounded-full border border-white/10 bg-[#1c1c1e]/90 p-2 text-gray-300 shadow-lg backdrop-blur-sm hover:bg-white/10 hover:text-white"><Clapperboard className="h-5 w-5" /></button>
      {open && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
        <section role="dialog" aria-modal="true" aria-labelledby="craft-analysis-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-[#151518] p-6 text-gray-100 shadow-2xl">
          <header className="mb-5 flex items-start justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-violet-300">Reference breakdown</p><h2 id="craft-analysis-title" className="mt-2 text-xl font-bold">영상 컷·기법 분석</h2></div><button type="button" onClick={() => setOpen(false)} disabled={running} className="rounded-full px-3 py-1 text-gray-400 hover:bg-white/10">✕</button></header>
          <p className="mb-5 text-sm leading-6 text-gray-400">현재는 로컬 영상과 미리 빌드한 기법 taxonomy를 분석합니다. 샷 분할은 후보 기반이며 장면 해석과 실제 제작 장비 식별은 추정/미확인일 수 있습니다.</p>
          <div className="space-y-4">
            <label className="block space-y-2 text-xs font-medium text-gray-300"><span>지원 플랫폼 영상 URL (다운로드 후 분석)</span><input type="url" value={videoUrl} onChange={(event) => { setVideoUrl(event.target.value); setVideoPath(''); setConfirmDownload(false); }} placeholder="https://www.youtube.com/watch?v=…" className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-xs text-gray-300" /></label>
            {videoUrl ? <label className="flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100"><input type="checkbox" checked={confirmDownload} onChange={(event) => setConfirmDownload(event.target.checked)} className="mt-1 accent-amber-500"/><span>이 URL의 영상 다운로드 권한이 있으며, Flucto가 영상을 내려받아 분석하는 데 동의합니다. 원본 영상은 결과 폴더의 `source` 하위 폴더에 남습니다.</span></label> : picker('분석할 로컬 영상 파일', videoPath, 'video')}
            {picker('Craft taxonomy 폴더 (taxonomy.csv 포함)', craftDir, 'craft')}
            <div>{picker('결과 저장 폴더', outputBaseDir, 'output')}<p className="mt-1 text-[11px] text-gray-500">기본 위치는 Documents/flucto이며, 찾아보기를 눌러 변경할 수 있습니다.</p></div>
            <label className="flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100"><input type="checkbox" checked={allowVision} onChange={(event) => setAllowVision(event.target.checked)} className="mt-1 accent-violet-500"/><span><span className="font-semibold">Codex 비전 분석 허용</span><br/>샷 대표 프레임이 로그인된 Codex CLI 계정으로 전송됩니다. Codex 구독의 사용량·제한·약관이 적용됩니다. 체크하지 않으면 프레임은 외부 전송하지 않습니다.</span></label>
            {allowVision && <label className="flex items-center justify-between gap-4 text-xs text-gray-300"><span>최대 모델 호출 수</span><input type="number" min={1} max={1000} value={maxApiCalls} onChange={(event) => setMaxApiCalls(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))} className="w-28 rounded-lg border border-white/10 bg-black/40 px-3 py-2"/></label>}
            {progress && <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-gray-300"><div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-violet-300" />{progress.stage}: {progress.message ?? '분석 중'} {progress.shotsTotal > 0 && `(${progress.shotsDone}/${progress.shotsTotal})`}</div></div>}
            {error && <p role="alert" className="flex gap-2 text-sm text-red-300"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</p>}
            {result && <div className="space-y-1 rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-3 text-xs text-emerald-100"><p>{result.shotCount} shots · {result.matchedTechniqueCount} techniques · {result.rowsIncomplete ? '부분/미확인 데이터 포함' : '완료'}</p><p className="break-all">shotlog: {result.shotlogPath}</p><p className="break-all">techniques: {result.techniquesPath}</p><p className="break-all">analysis: {result.analysisJsonPath}</p><p className="break-all">tools: {result.toolRecommendationsPath}</p></div>}
            <div className="flex items-center justify-between border-t border-white/10 pt-4"><span className="flex items-center gap-2 text-[11px] text-gray-500"><Sparkles size={14} />대표 프레임은 디스크에 저장하지 않습니다.</span><button type="button" onClick={() => void run()} disabled={running || (!videoPath && !videoUrl) || (Boolean(videoUrl) && !confirmDownload) || !craftDir || !outputBaseDir} className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold hover:bg-violet-500 disabled:opacity-40">{running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}{running ? '분석 중…' : '분석 시작'}</button></div>
          </div>
        </section>
      </div>}
    </div>
  );
}
