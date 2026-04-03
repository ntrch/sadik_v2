import { useContext } from 'react';
import { AppContext } from '../context/AppContext';
import { modesApi } from '../api/modes';

export function useMode() {
  const { currentMode, setCurrentMode } = useContext(AppContext);

  const setMode = async (mode: string) => {
    await modesApi.setMode(mode);
    setCurrentMode(mode);
  };

  return { currentMode, setMode };
}
