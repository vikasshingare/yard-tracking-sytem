import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

export default function useLocationCapture() {
  const [coords, setCoords] = useState(null);
  const [gpsMessage, setGpsMessage] = useState('Getting GPS…');

  const capture = useCallback(async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setCoords(null);
        setGpsMessage('GPS permission needed');
        return null;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next = { geoLat: position.coords.latitude, geoLong: position.coords.longitude, geoAccuracy: position.coords.accuracy };
      setCoords(next);
      setGpsMessage('GPS ready');
      return next;
    } catch {
      setCoords(null);
      setGpsMessage('GPS unavailable');
      return null;
    }
  }, []);

  useEffect(() => { capture(); }, [capture]);
  return { coords, gpsMessage, capture };
}
