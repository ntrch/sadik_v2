import React, { useState, useContext } from 'react';
import { Plus, ListTodo, Timer } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import TaskBoard from '../components/tasks/TaskBoard';
import TaskModal from '../components/tasks/TaskModal';
import PomodoroTimer from '../components/pomodoro/PomodoroTimer';
import TaskSelector from '../components/pomodoro/TaskSelector';
import { usePomodoro } from '../hooks/usePomodoro';
import { AppContext } from '../context/AppContext';

interface LocationState {
  taskId?: number;
  taskTitle?: string;
  tab?: 'focus';
}

export default function TasksPage() {
  const location = useLocation();
  const state = location.state as LocationState | null;
  const [activeTab, setActiveTab] = useState<'tasks' | 'focus'>(state?.tab === 'focus' ? 'focus' : 'tasks');
  const [showCreate, setShowCreate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Focus state
  const [selectedTask, setSelectedTask] = useState<number | null>(state?.taskId ?? null);
  const { pomodoroState, start, pause, resume, stop } = usePomodoro();
  const { showToast, triggerEvent } = useContext(AppContext);

  const handleStart = async () => {
    try {
      await start(selectedTask ?? undefined);
      triggerEvent('confirmation_success');
    } catch {
      showToast('Timer başlatılamadı', 'error');
    }
  };

  const handleStop = async () => {
    await stop();
    triggerEvent('confirmation_success');
    showToast('Pomodoro durduruldu');
  };

  return (
    <div className="h-full flex flex-col p-4 page-transition">
      {/* Tab selector */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-sm font-semibold transition-all ${
            activeTab === 'tasks'
              ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
              : 'bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
          }`}
        >
          <ListTodo size={18} className={activeTab === 'tasks' ? 'text-accent-purple' : ''} />
          Görevler
        </button>
        <button
          onClick={() => setActiveTab('focus')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-sm font-semibold transition-all ${
            activeTab === 'focus'
              ? 'bg-accent-orange/20 text-accent-orange border border-accent-orange/30'
              : 'bg-bg-card border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
          }`}
        >
          <Timer size={18} className={activeTab === 'focus' ? 'text-accent-orange' : ''} />
          Odaklanma
        </button>

        {activeTab === 'tasks' && (
          <button
            onClick={() => setShowCreate(true)}
            className="ml-auto flex items-center gap-2 px-4 py-2.5 bg-accent-purple hover:bg-accent-purple-hover text-white text-sm font-medium rounded-[14px] transition-colors"
          >
            <Plus size={16} />
            Yeni Görev
          </button>
        )}
      </div>

      {/* Tab content */}
      {activeTab === 'tasks' ? (
        <div className="flex-1 overflow-hidden">
          <TaskBoard key={refreshKey} highlightTaskId={state?.taskId ?? null} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-8">
          <TaskSelector value={selectedTask} onChange={setSelectedTask} />
          <PomodoroTimer
            state={pomodoroState}
            onStart={handleStart}
            onPause={pause}
            onResume={resume}
            onStop={handleStop}
          />
        </div>
      )}

      {showCreate && (
        <TaskModal
          onClose={() => setShowCreate(false)}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
