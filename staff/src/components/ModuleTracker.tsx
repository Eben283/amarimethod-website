import {
  MODULES,
  toggleModule,
  setYogaBlockSize,
  type ClientModuleData,
} from '../data/moduleStorage';

interface Props {
  data: ClientModuleData;
  onUpdate: (data: ClientModuleData) => void;
}

export default function ModuleTracker({ data, onUpdate }: Props) {
  function handleToggle(moduleId: string) {
    onUpdate(toggleModule(data, moduleId));
  }

  function handleBlockSize(size: '3' | '4') {
    onUpdate(setYogaBlockSize(data, size));
  }

  const taughtCount = MODULES.filter((m) => data.modules[m.id]).length;

  return (
    <div className="staff-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-amari-text-secondary uppercase tracking-wide">
          Modules Taught
        </h3>
        <span className="text-xs text-amari-text-muted">
          {taughtCount}/{MODULES.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-amari-light-sand rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-amari-accent-warm rounded-full transition-all duration-300"
          style={{ width: `${(taughtCount / MODULES.length) * 100}%` }}
        />
      </div>

      {/* Module grid */}
      <div className="grid grid-cols-2 gap-2">
        {MODULES.map((mod) => {
          const taught = !!data.modules[mod.id];
          return (
            <div key={mod.id}>
              <button
                onClick={() => handleToggle(mod.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 min-h-[44px] ${
                  taught
                    ? 'bg-amari-charcoal text-white'
                    : 'bg-white border border-amari-border text-amari-text-muted hover:bg-amari-light-sand'
                }`}
              >
                {mod.name}
              </button>

              {/* Yoga block size selector for bridge modules */}
              {(mod.id === 'active-bridge' || mod.id === 'passive-bridge') && taught && (
                <div className="flex items-center gap-2 mt-1.5 ml-1">
                  <span className="text-xs text-amari-text-muted">Block:</span>
                  {(['3', '4'] as const).map((size) => (
                    <button
                      key={size}
                      onClick={() => handleBlockSize(size)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all min-h-[32px] ${
                        data.yogaBlockSize === size
                          ? 'bg-amari-accent-warm text-white'
                          : 'bg-amari-light-sand text-amari-text-muted'
                      }`}
                    >
                      {size}"
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
