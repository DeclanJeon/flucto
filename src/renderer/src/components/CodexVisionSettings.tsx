import { useCallback, useMemo, useState } from 'react';
import { Cpu, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import type { CodexVisionModel, CodexVisionSettings as SettingsType } from '../../../shared/types';

const defaults: SettingsType = { modelID: '', binaryPath: '' };

export function CodexVisionSettings() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsType>(defaults);
  const [models, setModels] = useState<CodexVisionModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const selected = useMemo(() => models.find((model) => model.id === settings.modelID), [models, settings.modelID]);

  const refresh = useCallback(async (binaryPath: string) => {
    setLoading(true);
    setMessage('Codex CLI의 이미지 지원 모델을 확인하고 있습니다.');
    try {
      const available = await window.api.listCodexVisionModels(binaryPath || undefined);
      setModels(available);
      setMessage(available.length
        ? `이미지 입력이 가능한 Codex 모델 ${available.length}개를 찾았습니다.`
        : '이미지 입력 모델이 없습니다. Codex CLI 로그인 상태와 버전을 확인하세요.');
      setSettings((current) => ({ ...current, modelID: available.some((model) => model.id === current.modelID) ? current.modelID : '' }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const openSettings = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const current = await window.api.getCodexVisionSettings();
      setSettings(current);
      await refresh(current.binaryPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setLoading(false);
    }
  };

  const save = async () => {
    if (!settings.modelID) {
      setMessage('먼저 이미지 입력이 가능한 Codex 모델을 선택하세요.');
      return;
    }
    setSaving(true);
    try {
      await window.api.saveCodexVisionSettings(settings);
      setMessage('Codex 모델 설정을 저장했습니다. 인증은 Codex CLI 계정을 사용합니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed right-16 top-4 z-50">
      <button type="button" onClick={() => void openSettings()} title="Codex 비전 모델 설정" className="rounded-full border border-white/10 bg-[#1c1c1e]/90 p-2 text-gray-300 shadow-lg backdrop-blur-sm hover:bg-white/10 hover:text-white">
        <Cpu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="codex-title" className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#151518] p-6 text-gray-100 shadow-2xl">
            <header className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-blue-300">Codex CLI</p>
                <h2 id="codex-title" className="mt-2 text-xl font-bold">비전 모델 설정</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="rounded-full px-3 py-1 text-gray-400 hover:bg-white/10">✕</button>
            </header>
            <p className="mb-4 text-sm leading-6 text-gray-400">Codex CLI를 설치하고 터미널에서 <code>codex login</code>을 완료하세요. Flucto는 Codex 로그인 정보나 API 키를 저장하지 않습니다. 동의 후 프레임을 Codex 서비스로 전송하며, 사용량은 계정 구독·정책에 따라 제한될 수 있습니다. 프레임은 디스크 파일로 만들지 않고 요청 본문에 포함합니다.</p>
            <div className="space-y-4">
              <label className="block space-y-2 text-sm"><span>Codex CLI 실행 파일 (선택)</span><input type="text" value={settings.binaryPath} onChange={(event) => setSettings((current) => ({ ...current, binaryPath: event.target.value }))} placeholder="비워 두면 PATH에서 codex 검색" className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-xs text-gray-200" /><span className="block text-xs text-gray-500">Codex CLI를 PATH에서 찾을 수 없는 경우 실행 파일 경로를 입력하세요.</span></label>
              <label className="block space-y-2 text-sm"><span>이미지 입력 지원 Codex 모델</span><select value={selected?.id ?? ''} onChange={(event) => setSettings((current) => ({ ...current, modelID: event.target.value }))} disabled={loading} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-gray-100"><option value="">모델 선택…</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}</select>{selected && <span className="block text-xs text-gray-500">{selected.description || 'Codex 모델 카탈로그에서 이미지 입력을 지원한다고 보고했습니다.'}</span>}</label>
              <div className="flex gap-3"><button type="button" onClick={() => void refresh(settings.binaryPath)} disabled={loading} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm hover:bg-white/10 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}모델 목록 새로고침</button></div>
              <p role="status" className="min-h-5 text-xs text-gray-400">{message}</p>
              <div className="flex items-center justify-between border-t border-white/10 pt-4"><span className="flex items-center gap-2 text-xs text-gray-500"><ShieldCheck className="h-4 w-4" />프레임·인증정보를 보고서에 저장하지 않음</span><button type="button" onClick={() => void save()} disabled={saving || loading || !settings.modelID} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button></div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
