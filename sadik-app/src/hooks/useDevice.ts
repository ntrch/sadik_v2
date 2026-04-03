import { useContext } from 'react';
import { AppContext } from '../context/AppContext';
import { deviceApi } from '../api/device';

export function useDevice() {
  const { deviceStatus, setDeviceStatus } = useContext(AppContext);

  const connect = async (method: string, port?: string, ip?: string) => {
    const status = await deviceApi.connect({ method, port, ip });
    setDeviceStatus(status);
    return status;
  };

  const disconnect = async () => {
    const status = await deviceApi.disconnect();
    setDeviceStatus(status);
  };

  return { deviceStatus, connect, disconnect };
}
