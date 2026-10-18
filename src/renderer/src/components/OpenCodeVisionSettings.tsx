import { useCallback, useMemo, useState } from 'react';
import { Cpu, KeyRound, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import type { OpenCodeFreeVisionModel, OpenCodeVisionSettings as SettingsType } from '../../../shared/types';

const defaults: SettingsType = { providerID: '', modelID: '', variant: 'low', hasApiKey: false };
const optionId = (model: Pick<OpenCodeFreeVisionModel, 'providerID' | 'modelID'>) => `${model.providerID}::${model.modelID}`;

export function OpenCodeVisionSettings() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsType>(defaults);
  const [models, setModels] = useState<OpenCodeFreeVisionModel[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const selected = useMemo(() => models.find((model) => model.providerID === settings.providerID && model.modelID === settings.modelID), [models, settings]);
  const visibleModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return query ? models.filter((model) => `${model.name} ${model.providerID} ${model.modelID}`.toLowerCase().includes(query)) : models;
  }, [models, modelSearch]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage('OpenCode 모델 카탈로그를 불러오는 중입니다.');
    try {
      const available = await window.api.listOpenCodeFreeVisionModels();
      setModels(available);
      setMessage(available.length ? `이미지 입력과 무료 가격 정보가 확인된 모델 ${available.length}개` : '무료 이미지 입력 모델을 찾지 못했습니다. 카탈로그가 갱신되었는지 확인하세요.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const openSettings = () => {
    setOpen(true);
    void refresh();
    void window.api.getOpenCodeVisionSettings().then(setSettings).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });
  };

  const save = async () => {
    if (!settings.providerID || !settings.modelID) {
      setMessage('먼저 무료 비전 모델을 선택하세요.');
      return;
    }
    setSaving(true);
    try {
      await window.api.saveOpenCodeVisionSettings({
        providerID: settings.providerID,
        modelID: settings.modelID,
        variant: settings.variant,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(clearKey ? { clearApiKey: true } : {}),
      });
      const saved = await window.api.getOpenCodeVisionSettings();
      setSettings(saved);
      setApiKey('');
      setClearKey(false);
      setMessage(saved.hasApiKey ? '모델 설정과 API 키가 OS 보안 저장소에 저장되었습니다.' : '모델 설정을 저장했습니다. 분석에 사용할 API 키를 입력해야 합니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed right-16 top-4 z-50">
      <button type="button" onClick={openSettings} title="AI 비전 모델 설정" className="rounded-full border border-white/10 bg-[#1c1c1e]/90 p-2 text-gray-300 shadow-lg backdrop-blur-sm hover:bg-white/10 hover:text-white">
        <Cpu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="opencode-title" className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#151518] p-6 text-gray-100 shadow-2xl">
            <header className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-blue-300">Bundled OpenCode</p>
                <h2 id="opencode-title" className="mt-2 text-xl font-bold">무료 비전 모델 설정</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="rounded-full px-3 py-1 text-gray-400 hover:bg-white/10">✕</button>
            </header>
            <p className="mb-4 text-sm leading-6 text-gray-400">Flucto에 포함된 OpenCode가 모델 카탈로그를 조회합니다. 무료 여부는 카탈로그의 입력·출력 단가가 0으로 표시된 기준이며, 제공자의 가입·키·사용량 제한에 따라 호출이 거절될 수 있습니다. 영상에서 추출한 프레임은 선택한 제공자에게 전송됩니다.</p>
            <div className="space-y-4">
              <label className="block space-y-2 text-sm">
                <span>무료 이미지 입력 모델</span>
                <input type="search" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="모델명 또는 제공자 검색" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-300" />
                <select value={selected ? optionId(selected) : ''} onChange={(event) => {
                  const model = models.find((item) => optionId(item) === event.target.value);
                  if (model) setSettings((current) => ({ ...current, providerID: model.providerID, modelID: model.modelID, hasApiKey: current.providerID === model.providerID && current.hasApiKey }));
                }} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-gray-100" disabled={loading}>
                  <option value="">모델 선택…</option>
                  {visibleModels.map((model) => <option key={optionId(model)} value={optionId(model)}>{model.name} — {model.providerID} (카탈로그 $0 · 이미지 입력)</option>)}
                </select>
                {selected && <span className="block text-xs text-gray-500">model: {selected.providerID}/{selected.modelID}{selected.contextLimit ? ` · context ${selected.contextLimit.toLocaleString()}` : ''}</span>}
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2 text-sm"><span>추론 강도</span><select value={settings.variant} onChange={(event) => setSettings((current) => ({ ...current, variant: event.target.value as SettingsType['variant'] }))} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3"><option value="low">낮음 (기본)</option><option value="medium">중간</option><option value="high">높음</option></select></label>
                <div className="flex items-end"><button type="button" onClick={() => void refresh()} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm hover:bg-white/10 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}모델 목록 새로고침</button></div>
              </div>
              <label className="block space-y-2 text-sm"><span className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> 선택한 제공자 API 키 {settings.hasApiKey && <span className="text-emerald-300">저장됨</span>}</span><input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setClearKey(false); }} placeholder={settings.hasApiKey ? '기존 키 유지 (교체하려면 입력)' : '제공자 API 키 입력'} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-gray-100"/><span className="block text-xs text-gray-500">키는 Electron OS 보안 저장소에 암호화해 보관하며 renderer에 다시 전달하지 않습니다.</span></label>
              {settings.hasApiKey && <label className="flex items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} />저장된 키 삭제</label>}
              <p role="status" className="min-h-5 text-xs text-gray-400">{message}</p>
              <div className="flex items-center justify-between border-t border-white/10 pt-4"><span className="flex items-center gap-2 text-xs text-gray-500"><ShieldCheck className="h-4 w-4" />키를 로그·명령행 인자로 전달하지 않음</span><button type="button" onClick={() => void save()} disabled={saving || loading || !settings.providerID} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button></div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
