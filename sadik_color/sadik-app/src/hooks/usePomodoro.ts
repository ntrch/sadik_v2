import { useContext } from 'react';
import { AppContext } from '../context/AppContext';
import { pomodoroApi } from '../api/pomodoro';

export function usePomodoro() {
  const { pomodoroState, setPomodoroState } = useContext(AppContext);

  const start = async (taskId?: number, workMinutes?: number, breakMinutes?: number) => {
    const state = await pomodoroApi.start({
      task_id: taskId,
      work_minutes: workMinutes,
      break_minutes: breakMinutes,
    });
    setPomodoroState(state);
  };

  const pause = async () => {
    const state = await pomodoroApi.pause();
    setPomodoroState(state);
  };

  const resume = async () => {
    const state = await pomodoroApi.resume();
    setPomodoroState(state);
  };

  const stop = async () => {
    await pomodoroApi.stop();
    const state = await pomodoroApi.getState();
    setPomodoroState(state);
  };

  return { pomodoroState, start, pause, resume, stop };
}
