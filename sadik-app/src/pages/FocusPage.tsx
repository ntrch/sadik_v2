import React, { useState, useContext } from 'react';
import { useLocation } from 'react-router-dom';
import { AppContext } from '../context/AppContext';
import PomodoroTimer from '../components/pomodoro/PomodoroTimer';
import TaskSelector from '../components/pomodoro/TaskSelector';
import { usePomodoro } from '../hooks/usePomodoro';

interface LocationState {
  taskId?: number;
  taskTitle?: string;
}

export default function FocusPage() {
  const location = useLocation();
  const state = location.state as LocationState | null;
  const [selectedTask, setSelectedTask] = useState<number | null>(state?.taskId ?? null);
  const { pomodoroState, start, pause, resume, stop } = usePomodoro();
  const { showToast } = useContext(AppContext);

  const handleStart = async () => {
    try {
      await start(selectedTask ?? undefined);
    } catch {
      showToast('Timer başlatılamadı', 'error');
    }
  };

  const handleStop = async () => {
    await stop();
    showToast('Pomodoro durduruldu');
  };

  return (
    <div className="h-full flex flex-col items-center justify-center gap-8 p-6 page-transition">
      <h1 className="text-xl font-bold text-text-primary">Odaklanma</h1>

      <TaskSelector value={selectedTask} onChange={setSelectedTask} />

      <PomodoroTimer
        state={pomodoroState}
        onStart={handleStart}
        onPause={pause}
        onResume={resume}
        onStop={handleStop}
      />
    </div>
  );
}
