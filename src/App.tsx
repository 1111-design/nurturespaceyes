/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { motion, AnimatePresence } from "motion/react";
import { 
  Sparkles, 
  History, 
  Trash2, 
  RotateCcw, 
  Plus,
  Minus,
  X, 
  ChevronRight,
  ChevronLeft,
  Info,
  Check,
  Sun,
  Eraser,
  Droplets,
  Sprout,
  Mountain as MountainIcon,
  Compass,
  Undo,
} from "lucide-react";
import { SYMBOLS, CATEGORIES, SandboxObject, SandtraySession } from "./constants";
import { Sandbox3D } from "./components/Sandbox3D";
import * as THREE from "three";

interface UndoSnapshot {
  objects: SandboxObject[];
  terrain: {
    heights: Float32Array;
    types: Uint8Array;
  };
}

export default function App() {
  const [objects, setObjects] = useState<SandboxObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [session, setSession] = useState<SandtraySession | null>(null);
  const [history, setHistory] = useState<SandtraySession[]>([]);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  
  const [activeCategory, setActiveCategory] = useState<string>('sculpt');
  const [activeSymbolType, setActiveSymbolType] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<'sculpt' | 'water' | 'grass' | 'object' | 'clear_terrain'>('sculpt');
  const [autoRotate, setAutoRotate] = useState(false);

  const controlsRef = useRef<any>(null);
  const sandbox3DRef = useRef<any>(null);

  // Undo system references
  const undoStackRef = useRef<UndoSnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const objectsRef = useRef<SandboxObject[]>(objects);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  // Capture current sandbox state and push it onto the undo stack
  const pushUndo = useCallback(() => {
    if (sandbox3DRef.current) {
      const terrainSnap = sandbox3DRef.current.getTerrainSnapshot();
      undoStackRef.current.push({
        objects: JSON.parse(JSON.stringify(objectsRef.current)),
        terrain: {
          heights: new Float32Array(terrainSnap.heights),
          types: new Uint8Array(terrainSnap.types)
        }
      });
      if (undoStackRef.current.length > 50) {
        undoStackRef.current.shift();
      }
      setCanUndo(true);
    }
  }, []);

  const handleUndo = () => {
    if (undoStackRef.current.length > 0) {
      const lastState = undoStackRef.current.pop();
      if (lastState && sandbox3DRef.current) {
        setObjects(lastState.objects);
        sandbox3DRef.current.restoreTerrainSnapshot(lastState.terrain);
        setSelectedId(null);
      }
      setCanUndo(undoStackRef.current.length > 0);
    }
  };

  const [initialCameraPos] = useState<[number, number, number]>(() => {
    const saved = localStorage.getItem("nurturespace_camera_pos");
    return saved ? JSON.parse(saved) : [18, 18, 18];
  });
  const [initialCameraTarget] = useState<[number, number, number]>(() => {
    const saved = localStorage.getItem("nurturespace_camera_target");
    return saved ? JSON.parse(saved) : [0, 0, 0];
  });

  const handleControlsEnd = () => {
    if (controlsRef.current) {
      const controls = controlsRef.current;
      const camera = controls.object;
      const target = controls.target;
      const pos = [camera.position.x, camera.position.y, camera.position.z];
      const tgt = [target.x, target.y, target.z];
      localStorage.setItem("nurturespace_camera_pos", JSON.stringify(pos));
      localStorage.setItem("nurturespace_camera_target", JSON.stringify(tgt));
    }
  };



  // Load history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem("nurturespace_history");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  const saveToHistory = useCallback((updatedHistory: SandtraySession[]) => {
    setHistory(updatedHistory);
    localStorage.setItem("nurturespace_history", JSON.stringify(updatedHistory));
  }, []);

  const addObjectAt = (x: number, z: number, y: number) => {
    if (!activeSymbolType) return;
    
    pushUndo();
    const newObj: SandboxObject = {
      id: Math.random().toString(36).substr(2, 9),
      type: activeSymbolType,
      label: "新对象",
      x,
      z,
      y,
      scale: 1,
      rotation: 0
    };
    setObjects([...objects, newObj]);
    setSelectedId(newObj.id);
  };

  const updateObject = (id: string, updates: Partial<SandboxObject>) => {
    setObjects(objects.map(obj => obj.id === id ? { ...obj, ...updates } : obj));
  };

  const removeObject = (id: string) => {
    pushUndo();
    setObjects(objects.filter(obj => obj.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const clearSandbox = () => {
    setShowResetConfirm(true);
  };

  const confirmClearSandbox = () => {
    pushUndo();
    setObjects([]);
    setSelectedId(null);
    setSession(null);
    setShowResetConfirm(false);
    if (sandbox3DRef.current && typeof sandbox3DRef.current.clearTerrain === "function") {
      sandbox3DRef.current.clearTerrain();
    }
  };

  const adjustScale = (id: string, delta: number) => {
    const obj = objects.find(o => o.id === id);
    if (obj) {
      pushUndo();
      updateObject(id, { scale: Math.max(0.2, Math.min(3, (obj.scale || 1) + delta)) });
    }
  };

  const interpretScene = async () => {
    if (objects.length === 0) return;
    
    setIsInterpreting(true);
    try {
      const response = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          scene: objects,
          history: history.slice(0, 3)
        }),
      });
      const data = await response.json();
      
      const newSession: SandtraySession = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        objects,
        interpretation: data.interpretation,
        name: data.suggestedName,
        insights: data.insights || [],
        weather: 'sunny'
      };
      
      setSession(newSession);
      saveToHistory([newSession, ...history]);
      setSelectedId(null);
    } catch (error) {
      console.error("AI interpretation failed:", error);
    } finally {
      setIsInterpreting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#F9F7F2] flex flex-col font-sans overflow-hidden select-none">
      {/* Top Header - Compact for Mobile */}
      <nav className="h-14 border-b border-nurture-sage/10 flex items-center justify-between px-3 sm:px-4 bg-white/60 backdrop-blur-md z-[100]">
        <div className="flex items-center gap-1.5 sm:gap-2">
            <h1 className="text-base sm:text-lg md:text-xl font-serif font-semibold tracking-tight text-nurture-ink">NurtureSpace</h1>
            <span className="hidden xs:inline-block text-[9px] sm:text-[10px] bg-nurture-sage/10 px-1 py-0.5 sm:px-1.5 rounded text-nurture-sage font-bold tracking-widest leading-none">ALPHA</span>
        </div>
        
        <div className="flex items-center gap-1.5 sm:gap-3">
            <button 
                onClick={handleUndo}
                disabled={!canUndo}
                className={`flex items-center gap-1 px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-full text-xs font-medium active:scale-95 transition-all shadow-sm border ${
                    canUndo 
                    ? 'bg-white text-nurture-sage border-nurture-sage/40 hover:bg-nurture-sage/5 hover:text-nurture-sage' 
                    : 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed opacity-60'
                }`}
                title="撤销上一步操作"
            >
                <Undo size={14} />
                <span className="hidden xs:inline">撤销</span>
            </button>
            <button 
                onClick={() => setAutoRotate(!autoRotate)}
                className={`flex items-center gap-1 px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-full text-xs font-medium active:scale-95 transition-all shadow-sm border ${
                    autoRotate 
                    ? 'bg-[#EBF5EF] text-nurture-sage border-nurture-sage/40 shadow-sm font-semibold' 
                    : 'bg-white text-nurture-muted border-nurture-sage/20 hover:text-nurture-sage hover:bg-nurture-sage/5'
                }`}
                title="开启/关闭全景巡航，360°全方位自动旋转视角赏析沙盘"
            >
                <Compass size={14} className={autoRotate ? "animate-[spin_20s_linear_infinite]" : ""} />
                <span className="hidden sm:inline">360°全景巡航</span>
                <span className="inline sm:hidden hidden xs:inline">巡航</span>
            </button>
            <button 
                onClick={interpretScene}
                disabled={objects.length === 0 || isInterpreting}
                className="flex items-center gap-1 px-2.5 py-1.5 sm:px-3 sm:py-1.5 bg-nurture-sage text-white rounded-full text-xs font-medium hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-nurture-sage/20 disabled:opacity-50"
            >
                {isInterpreting ? <RotateCcw className="animate-spin" size={14} /> : <Sparkles size={14} />}
                <span>解读</span>
            </button>
        </div>
      </nav>

      <main className="flex-1 relative flex">
        <div className="absolute inset-0 z-10">
          <Canvas shadows dpr={[1, 2]}>
            <Suspense fallback={null}>
              <PerspectiveCamera makeDefault position={initialCameraPos} fov={40} />
              <OrbitControls 
                  ref={controlsRef}
                  makeDefault 
                  enableDamping 
                  dampingFactor={0.05}
                  minPolarAngle={Math.PI / 12}
                  maxPolarAngle={Math.PI / 2.1}
                  minDistance={8}
                  maxDistance={140}
                  enabled={true}
                  target={initialCameraTarget}
                  onEnd={handleControlsEnd}
                  autoRotate={autoRotate}
                  autoRotateSpeed={1.0}
                  mouseButtons={
                    (editMode !== 'object' || activeSymbolType !== null) ? {
                      LEFT: null as any,
                      MIDDLE: THREE.MOUSE.DOLLY,
                      RIGHT: THREE.MOUSE.ROTATE
                    } : {
                      LEFT: THREE.MOUSE.ROTATE,
                      MIDDLE: THREE.MOUSE.DOLLY,
                      RIGHT: THREE.MOUSE.PAN
                    }
                  }
                  touches={
                    (editMode !== 'object' || activeSymbolType !== null) ? {
                      ONE: null as any,
                      TWO: THREE.TOUCH.DOLLY_PAN
                    } : {
                      ONE: THREE.TOUCH.ROTATE,
                      TWO: THREE.TOUCH.DOLLY_PAN
                    }
                  }
              />
              <Sandbox3D 
                  ref={sandbox3DRef}
                  objects={objects}
                  onObjectMove={(id, x, z, y) => updateObject(id, { x, z, y })}
                  onObjectSelect={setSelectedId}
                  selectedId={selectedId}
                  mode={editMode}
                  activeObjectId={activeSymbolType}
                  onAddObjectAt={addObjectAt}
                  onStartAction={pushUndo}
              />
            </Suspense>
          </Canvas>
        </div>

        <AnimatePresence>
            {selectedId && (
                <motion.div 
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 15 }}
                    className="absolute bottom-[200px] left-1/2 -translate-x-1/2 sm:bottom-36 sm:left-6 sm:translate-x-0 flex flex-row sm:flex-col gap-2 z-50 pointer-events-none"
                >
                    <div className="flex flex-row sm:flex-col bg-white/95 backdrop-blur-md p-1.5 sm:p-2 rounded-2xl border border-nurture-sage/20 shadow-2xl pointer-events-auto items-center gap-1 sm:gap-0">
                        <button onClick={() => adjustScale(selectedId, 0.2)} className="p-2 sm:p-3 hover:bg-nurture-sage/5 rounded-xl transition-colors text-nurture-ink" title="放大物形"><Plus size={18} /></button>
                        <button onClick={() => adjustScale(selectedId, -0.2)} className="p-2 sm:p-3 hover:bg-nurture-sage/5 rounded-xl transition-colors text-nurture-ink" title="缩小物形"><Minus size={18} /></button>
                        <button 
                            onClick={() => {
                                const obj = objects.find(o => o.id === selectedId);
                                if (obj) {
                                    pushUndo();
                                    updateObject(selectedId, { rotation: obj.rotation + Math.PI/4 });
                                }
                            }} 
                            className="p-2 sm:p-3 hover:bg-nurture-sage/5 rounded-xl transition-colors text-nurture-ink"
                            title="旋转物形"
                        >
                            <RotateCcw size={18} />
                        </button>
                        <div className="w-px h-6 sm:w-6 sm:h-px bg-nurture-sage/15 my-1 mx-1.5 shrink-0" />
                        <button onClick={() => removeObject(selectedId)} className="p-2 sm:p-3 hover:bg-red-50 text-red-500 rounded-xl transition-colors" title="移除物形"><Trash2 size={18} /></button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>

        <button 
            onClick={() => setShowTimeline(true)}
            className="absolute top-4 left-4 z-40 w-10 h-10 bg-white/80 backdrop-blur-md rounded-xl flex items-center justify-center text-nurture-sage shadow-md border border-white/50 hover:bg-white active:scale-95 transition-all"
        >
            <History size={20} />
        </button>

        <div className="absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-lg z-40 pointer-events-none">
            <div className="bg-white/90 backdrop-blur-xl p-3 rounded-[30px] border border-white/40 shadow-[0_20px_50px_rgba(0,0,0,0.1)] flex flex-col items-center gap-2.5 pointer-events-auto">
                
                {/* Segmented Category Selection Tabs */}
                <div className="flex w-full justify-between gap-1 p-0.5 bg-nurture-sage/5 rounded-xl border border-nurture-sage/5">
                    {CATEGORIES.map(cat => (
                        <button
                            key={cat.id}
                            onClick={() => {
                                setActiveCategory(cat.id);
                                if (cat.id !== 'sculpt') setEditMode('object');
                                else setEditMode('sculpt');
                                setActiveSymbolType(null);
                            }}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg transition-all font-sans text-xs font-semibold ${
                                activeCategory === cat.id 
                                ? 'bg-nurture-sage text-white shadow-sm' 
                                : 'text-nurture-muted hover:bg-nurture-sage/10 hover:text-nurture-sage'
                            }`}
                        >
                            <cat.icon size={14} />
                            <span>{cat.label}</span>
                        </button>
                    ))}
                </div>

                {/* Subtools or Symbol Palette */}
                <div className="flex gap-4 overflow-x-auto w-full px-1 py-0.5 scrollbar-hide items-center justify-start">
                    {activeCategory === 'sculpt' ? (
                        <div className="flex gap-4 w-full justify-around py-0.5 animate-fadeIn">
                            {[
                                { id: 'sculpt', icon: MountainIcon, label: '堆沙' },
                                { id: 'grass', icon: Sprout, label: '植草' },
                                { id: 'water', icon: Droplets, label: '水源' },
                                { id: 'clear_terrain', icon: Eraser, label: '平整' }
                            ].map(tool => (
                                <button
                                    key={tool.id}
                                    onClick={() => setEditMode(tool.id as any)}
                                    className={`flex flex-col items-center gap-1 transition-transform active:scale-90`}
                                >
                                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${editMode === tool.id ? 'bg-nurture-sage text-white rotate-3 shadow-md' : 'bg-nurture-sage/5 text-nurture-muted hover:bg-nurture-sage/10'}`}>
                                        <tool.icon size={18} />
                                    </div>
                                    <span className={`text-[9px] font-bold ${editMode === tool.id ? 'text-nurture-sage' : 'text-nurture-muted'}`}>{tool.label}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="flex gap-3.5 py-0.5 items-center w-full overflow-x-auto scrollbar-hide">
                            {SYMBOLS[activeCategory]?.map((s) => (
                                <button
                                    key={s.type}
                                    onClick={() => {
                                        setActiveSymbolType(s.type);
                                        setEditMode('object');
                                    }}
                                    className={`flex-shrink-0 flex flex-col items-center gap-1 transition-transform active:scale-90`}
                                >
                                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${activeSymbolType === s.type ? 'bg-nurture-sage text-white -rotate-3 shadow-md' : 'bg-white border border-nurture-sage/10 text-nurture-ink hover:shadow'}`}>
                                        <s.icon size={18} />
                                    </div>
                                    <span className={`text-[9px] font-bold ${activeSymbolType === s.type ? 'text-nurture-sage' : 'text-nurture-muted'}`}>{s.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
      </main>

      <AnimatePresence>
        {session && (
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4">
            <motion.div 
               initial={{ opacity: 0 }} 
               animate={{ opacity: 1 }} 
               exit={{ opacity: 0 }}
               className="absolute inset-0 bg-black/40 backdrop-blur-sm"
               onClick={() => setSession(null)}
            />
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="w-full max-w-lg bg-white rounded-t-[3rem] sm:rounded-[3rem] shadow-2xl relative z-10 overflow-hidden max-h-[85vh] flex flex-col"
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-nurture-sand via-nurture-sage to-nurture-sand" />
              <div className="p-8 overflow-y-auto">
                <div className="flex justify-between items-start mb-6">
                    <h2 className="font-serif text-3xl italic text-nurture-ink">「{session.name}」</h2>
                    <button onClick={() => setSession(null)} className="p-2 text-nurture-muted">
                        <X size={24} />
                    </button>
                </div>
                <div className="space-y-8">
                    <p className="font-serif text-xl italic text-nurture-ink/80 leading-relaxed border-l-4 border-nurture-sage/20 pl-4 py-2">
                    “{session.interpretation}”
                    </p>
                    <div className="grid grid-cols-1 gap-4 mt-8">
                        {session.insights?.map((insight, i) => (
                            <div key={i} className="bg-nurture-sage/5 p-4 rounded-2xl flex gap-4 items-start border border-nurture-sage/10">
                                <div className="mt-1 w-5 h-5 rounded-full bg-nurture-sage/20 flex items-center justify-center text-nurture-sage shrink-0">
                                    <Check size={12} />
                                </div>
                                <p className="text-sm text-nurture-ink/70">{insight}</p>
                            </div>
                        ))}
                    </div>
                </div>
              </div>
              <div className="p-8 pt-0 mt-auto grid grid-cols-2 gap-4">
                 <button onClick={() => setSession(null)} className="py-4 bg-nurture-sage text-white rounded-2xl font-medium shadow-xl">继续探索</button>
                 <button onClick={clearSandbox} className="py-4 border border-nurture-sage/20 text-nurture-muted rounded-2xl">重置沙盘</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showWelcome && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#F9F7F2] z-[300] flex items-center justify-center p-8 text-center"
          >
            <div className="max-w-sm space-y-10">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }} className="w-32 h-32 border-2 border-dashed border-nurture-sage/30 rounded-full mx-auto flex items-center justify-center p-4">
                 <div className="w-full h-full bg-nurture-sand rounded-full flex items-center justify-center">
                    <Sparkles size={48} className="text-nurture-sage" />
                 </div>
              </motion.div>
              <div className="space-y-4">
                <h2 className="font-serif text-5xl tracking-tighter text-nurture-ink">NurtureSpace</h2>
                <p className="text-nurture-muted text-lg font-serif">在这个宁静的数字沙盘里，<br/>堆沙、植草、引水，用符号和色彩，<br/>表达言语未及的深情。</p>
              </div>
              <button onClick={() => setShowWelcome(false)} className="w-full bg-nurture-sage text-white py-5 rounded-3xl shadow-xl font-serif text-xl tracking-widest hover:scale-105 active:scale-95 transition-all">步入宁静</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTimeline && (
          <div className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTimeline(false)} />
             <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} className="w-full max-w-sm bg-white rounded-3xl shadow-2xl relative z-10 h-full max-h-[85vh] sm:max-h-full flex flex-col overflow-hidden">
                <div className="p-6 flex items-center justify-between border-b border-nurture-sage/10">
                    <h2 className="font-serif text-2xl text-nurture-ink">心路历程</h2>
                    <button onClick={() => setShowTimeline(false)} className="p-2 text-nurture-muted rounded-full hover:bg-nurture-sage/5"><X size={24} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
                    {history.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-nurture-muted opacity-40"><p className="font-serif italic text-sm">暂无记录</p></div>
                    ) : (
                        history.map((s) => (
                            <div key={s.id} className="relative pl-6 border-l-2 border-nurture-sage/20 py-1">
                                <div className="absolute -left-[7px] top-4 w-3 h-3 rounded-full bg-nurture-sage" />
                                <span className="text-[10px] uppercase tracking-widest font-bold text-nurture-muted block mb-2">{new Date(s.timestamp).toLocaleDateString('zh-CN')}</span>
                                <div onClick={() => { setObjects(s.objects); setSession(s); setShowTimeline(false); }} className="bg-nurture-sage/5 p-4 rounded-2xl cursor-pointer hover:bg-nurture-sage/10 border border-nurture-sage/10 transition-all font-serif">「{s.name}」</div>
                            </div>
                        ))
                    )}
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showResetConfirm && (
          <div className="fixed inset-0 z-[260] flex items-center justify-center p-4">
             <motion.div 
               initial={{ opacity: 0 }} 
               animate={{ opacity: 1 }} 
               exit={{ opacity: 0 }} 
               className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
               onClick={() => setShowResetConfirm(false)} 
             />
             <motion.div 
               initial={{ scale: 0.9, opacity: 0 }} 
               animate={{ scale: 1, opacity: 1 }} 
               exit={{ scale: 0.9, opacity: 0 }} 
               className="w-full max-w-sm bg-[#FDFBF7] rounded-[2.5rem] shadow-2xl relative z-10 p-8 text-center border border-nurture-sage/10 overflow-hidden"
             >
               <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-nurture-sand via-nurture-sage to-nurture-sand" />
               <div className="w-16 h-16 bg-nurture-sage/10 rounded-full flex items-center justify-center mx-auto mb-6 text-nurture-sage">
                 <Sparkles size={28} />
               </div>
               
               <h3 className="font-serif text-2xl text-nurture-ink mb-3 font-medium">重置沙盘，重新启程吗？</h3>
               <p className="text-sm text-[#5C5245] leading-relaxed font-serif mb-8 max-w-xs mx-auto">
                 亲爱的妈妈，清空当前摆放的物件和地貌将给您展现一个全新的、平整如初的世界。这一刻的创意与思绪已轻柔存入「心路历程」中。
               </p>

               <div className="grid grid-cols-2 gap-4">
                 <button 
                   onClick={() => setShowResetConfirm(false)} 
                   className="py-3.5 border border-nurture-sage/20 text-nurture-muted rounded-2xl text-sm font-medium hover:bg-nurture-sage/5 transition-all active:scale-95"
                 >
                   继续保留
                 </button>
                 <button 
                   onClick={confirmClearSandbox} 
                   className="py-3.5 bg-nurture-sage text-white rounded-2xl text-sm font-medium shadow-md hover:shadow-lg transition-all active:scale-95"
                 >
                   确定清空
                 </button>
               </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `.scrollbar-hide::-webkit-scrollbar { display: none; } .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }` }} />
    </div>
  );
}
