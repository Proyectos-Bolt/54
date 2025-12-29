import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play,
  Square,
  RotateCcw,
  MapPin,
  Navigation,
  DollarSign,
  Zap,
  Route,
  Clock,
  Pause,
  Info,
  ChevronDown,
  ChevronUp,
  Gauge,
  MapPinned,
  Users,
  Car,
  Plus,
  Minus,
  FastForward,
  ShoppingBag,
  Calendar
} from 'lucide-react';
import { db } from './firebase';
import { collection, doc, setDoc, serverTimestamp, getDoc, addDoc, getDocs, query, orderBy } from 'firebase/firestore';
import { auth } from './firebase';

// [Otras interfaces y constantes como Position, TripData, RATES, etc. se mantienen igual]

interface Position {
  latitude: number;
  longitude: number;
  timestamp: number;
}

interface TripData {
  distance: number;
  cost: number;
  waitingTime: number;
  isRunning: boolean;
  isPaused: boolean;
  rawDistance: number; // Distancia sin descuentos para mostrar en debug
}

interface TripType {
  id: string;
  name: string;
  description: string;
  fixedPrice?: number;
  distanceKm?: number;
  subTrips?: SubTrip[];
}

interface SubTrip {
  id: string;
  name: string;
  fixedPrice: number;
}

interface TripSummary {
  tripType: string;
  distance: number;
  waitingTime: number;
  cost: number;
  timestamp: string;
  isSorianaActive: boolean;
  petConfig: PetConfig;
  servicioEspecialConfig: ServicioEspecialConfig;
  personasExtrasConfig: PersonasExtrasConfig;
  numeroParadas: number;
  costoParadas: number; // Se asegura que el costo de paradas esté aquí
}

interface PetConfig {
  active: boolean;
  withCage: boolean | null;
  cost: number;
}

interface ServicioEspecialConfig {
  active: boolean;
  type: 'recoger' | 'comprar' | null;
  cost: number;
}

interface PersonasExtrasConfig {
  active: boolean;
  ninos: number;
  adultos: number;
  cost: number;
}
// Configuración de tarifas
const RATES = {
  baseFare: 50,
  waitingRate: 3, // MXN por minuto
  distanceRates: [
    { min: 0, max: 3.99, price: 50 },
    { min: 4, max: 4.99, price: 55 },
    { min: 5, max: 5.99, price: 60 },
    { min: 6, max: 6.99, price: 65 },
    { min: 7, max: 7.99, price: 70 },
    { min: 8, max: Infinity, basePrice: 80, extraRate: 16 }
  ],
  paradaRapida: 20, // Nuevo costo para parada rápida
  paradaServicio: 50 // Costo para servicio de parada
};

// Tipos de viaje
const TRIP_TYPES: TripType[] = [
  {
    id: 'normal',
    name: 'Viaje Normal',
    description: 'Tarifa por distancia recorrida'
  },
  {
    id: 'walmart',
    name: 'Ruta Walmart',
    description: 'Centro → Walmart Guzmán',
    distanceKm: 5.2,
    fixedPrice: 60
  },
  {
    id: 'tecnologico',
    name: 'Ruta Tecnológico',
    description: 'Centro → Tec. Guzmán',
    distanceKm: 5.9,
    fixedPrice: 70
  },
  {
    id: 'cristoRey',
    name: 'Ruta Cristo Rey',
    description: 'Centro → Cerro Cristo Rey',
    subTrips: [
      {
        id: 'cristoRey-cano',
        name: 'Caño',
        fixedPrice: 60
      },
      {
        id: 'cristoRey-mitad',
        name: 'Mitad',
        fixedPrice: 70
      },
      {
        id: 'cristoRey-arriba',
        name: 'Arriba',
        fixedPrice: 80
      }
    ]
  },
  {
    id: 'colmena',
    name: 'La Colmena',
    description: 'Precio base $120',
    fixedPrice: 120
  }
];

// Zonas especiales ($70 MXN) en orden alfabético
const SPECIAL_ZONES = [
  'Américas',
  'Col. San José',
  'Emiliano Zapata',
  'Las Garzas',
  'Las Lomas',
  'Pueblos de Jalisco',
  'Valle de Zapotlan'
].sort();


// Función para calcular distancia entre dos puntos GPS (fórmula Haversine)
const calculateDistance = (pos1: Position, pos2: Position): number => {
  // Fórmula de Vincenty - Mucho más precisa para distancias cortas
  // Parámetros del elipsoide WGS84
  const a = 6378137; // Semi-eje mayor en metros
  const b = 6356752.314245; // Semi-eje menor en metros
  const f = 1 / 298.257223563; // Aplanamiento
  
  const lat1 = pos1.latitude * Math.PI / 180;
  const lat2 = pos2.latitude * Math.PI / 180;
  const deltaLon = (pos2.longitude - pos1.longitude) * Math.PI / 180;
  
  const L = deltaLon;
  const U1 = Math.atan((1 - f) * Math.tan(lat1));
  const U2 = Math.atan((1 - f) * Math.tan(lat2));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);
  
  let lambda = L;
  let lambdaP;
  let iterLimit = 100;
  let cosSqAlpha, sinSigma, cos2SigmaM, cosSigma, sigma;
  
  do {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt((cosU2 * sinLambda) * (cosU2 * sinLambda) +
      (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda));
    
    if (sinSigma === 0) return 0; // Puntos coincidentes
    
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;
    
    if (isNaN(cos2SigmaM)) cos2SigmaM = 0; // Línea ecuatorial
    
    const C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    lambdaP = lambda;
    lambda = L + (1 - C) * f * sinAlpha *
      (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(lambda - lambdaP) > 1e-12 && --iterLimit > 0);
  
  if (iterLimit === 0) {
    // Fallback a fórmula más simple si no converge
    const R = 6371000;
    const dLat = (pos2.latitude - pos1.latitude) * Math.PI / 180;
    const dLon = (pos2.longitude - pos1.longitude) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(pos1.latitude * Math.PI / 180) * Math.cos(pos2.latitude * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
  
  const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
  const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma = B * sinSigma * (cos2SigmaM + B / 4 * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
    B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  
  const distance = b * A * (sigma - deltaSigma);
  
  // Factor de corrección reducido ya que Vincenty es más preciso
  // Solo un pequeño ajuste para compensar el filtrado del GPS móvil
  const correctionFactor = 1.15; // Reducido del 40% al 15%
  
  return distance * correctionFactor;
};

// Componente principal de la aplicación
function App() {
  const [tripData, setTripData] = useState<TripData>({
    distance: 0,
    cost: RATES.baseFare,
    waitingTime: 0,
    isRunning: false,
    isPaused: false,
    rawDistance: 0
  });

  const [currentPosition, setCurrentPosition] = useState<Position | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'requesting' | 'available' | 'denied' | 'unavailable'>('requesting');
  const [selectedTripType, setSelectedTripType] = useState<TripType>(TRIP_TYPES[0]);
  const [selectedSubTrip, setSelectedSubTrip] = useState<SubTrip | null>(null);
  const [showTripTypeSelector, setShowTripTypeSelector] = useState(false);
  const [showSubTripSelector, setShowSubTripSelector] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [lastTripSummary, setLastTripSummary] = useState<TripSummary | null>(null);
  const [showRates, setShowRates] = useState(false);
  const [currentAddress, setCurrentAddress] = useState<string>(''); // No usada actualmente, pero se mantiene
  const [googleMapsReady, setGoogleMapsReady] = useState(false); // No usada actualmente, pero se mantiene
  const [totalWaitingTime, setTotalWaitingTime] = useState(0);
  const [showExtrasSelector, setShowExtrasSelector] = useState(false);
  const [serviciosExtrasActive, setServiciosExtrasActive] = useState(false); // No usada actualmente, pero se mantiene
  const [showPetSelector, setShowPetSelector] = useState(false);
  const [petConfig, setPetConfig] = useState<PetConfig>({
    active: false,
    withCage: null,
    cost: 0
  });
  const [showServicioEspecialSelector, setShowServicioEspecialSelector] = useState(false);
  const [servicioEspecialConfig, setServicioEspecialConfig] = useState<ServicioEspecialConfig>({
    active: false,
    type: 'recoger' as const,
    cost: 0
  });
  const [showFinalizarParada, setShowFinalizarParada] = useState(false); // No usada actualmente, pero se mantiene
  const [costoAcumuladoParadas, setCostoAcumuladoParadas] = useState(0);
  const [numeroParadas, setNumeroParadas] = useState(0);
  const [showPersonasExtrasSelector, setShowPersonasExtrasSelector] = useState(false);
  const [personasExtrasConfig, setPersonasExtrasConfig] = useState<PersonasExtrasConfig>({
    active: false,
    ninos: 0,
    adultos: 0,
    cost: 0
  });
  // Nuevo estado para el selector de tipo de parada
  const [showParadaSelector, setShowParadaSelector] = useState(false); 


  // Estado para el check de Soriana
  const [isSorianaActive, setIsSorianaActive] = useState(false);
  const [selectedSorianaZone, setSelectedSorianaZone] = useState<string | null>(null);

  // Estado para la simulación
  const [isSimulating, setIsSimulating] = useState(false);
  const simulationInterval = useRef<NodeJS.Timeout | null>(null);

  // Estado para modal de Foraneos
  const [showForaneosModal, setShowForaneosModal] = useState(false);

  // Estado para ganancias del día
  const [dailyEarnings, setDailyEarnings] = useState(0);
  const [showEarningsModal, setShowEarningsModal] = useState(false);

  // Estado para ganancias mensuales
  const [showMonthlyEarningsModal, setShowMonthlyEarningsModal] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [monthlyEarningsData, setMonthlyEarningsData] = useState<Array<{dia: number, ganancia: number}>>([]);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);

  // Referencias para mantener estado en callbacks
  const isActiveRef = useRef(false);
  const lastPositionRef = useRef<Position | null>(null);
  const waitingStartTime = useRef<number | null>(null);
  const waitingInterval = useRef<NodeJS.Timeout | null>(null);

  // Función para calcular la tarifa
  const getBasePrice = (tripType: TripType): number => {
    if (selectedSubTrip && tripType.id === 'cristoRey') {
      return selectedSubTrip.fixedPrice;
    }
    return tripType.fixedPrice || RATES.baseFare;
  };

  // Función para manejar la adición de una parada (rápida o de servicio)
  const handleParadaAdd = (cost: number, resetDistance: boolean = false) => {
    setNumeroParadas(prev => prev + 1);
    setCostoAcumuladoParadas(prev => prev + cost);

    // Si es parada con servicio, reiniciar la distancia
    if (resetDistance) {
      setTripData(prev => ({
        ...prev,
        distance: 0,
        rawDistance: 0
      }));
      lastPositionRef.current = null;
    }

    setShowParadaSelector(false);
  };

  // Función para calcular la tarifa
  const calculateFare = useCallback((distanceKm: number, waitingMinutes: number, sorianaBonus: boolean = false, accumulatedStopsCost: number = costoAcumuladoParadas) => {
    // Calcular costo adicional de mascotas
    const petExtraFee = petConfig.active ? petConfig.cost : 0;

    // Calcular costo adicional de personas extras
    const personasExtrasFee = personasExtrasConfig.active ? personasExtrasConfig.cost : 0;

    // Si zona especial está activa Y se seleccionó una zona, el costo es fijo de $70 MXN
    if (sorianaBonus && selectedSorianaZone) {
      return accumulatedStopsCost + 70 + (waitingMinutes * RATES.waitingRate) + petExtraFee + personasExtrasFee;
    }

    // Lógica especial para Colmena
    if (selectedTripType.id === 'colmena') {
      let fare = 120;
      if (distanceKm > 4.9) {
        const kmExtra = distanceKm - 4.9;
        fare = 120 + (Math.ceil(kmExtra) * 10);
      }
      return accumulatedStopsCost + fare + (waitingMinutes * RATES.waitingRate) + petExtraFee + personasExtrasFee;
    }

    // Calcular extra de $5 MXN para viajes diferentes al normal después de 3.7 km
    // O si zona especial está activa sin zona seleccionada
    const tripTypeExtraFee = ((selectedTripType.id !== 'normal' || (sorianaBonus && !selectedSorianaZone)) && distanceKm >= 3.7) ? 5 : 0;

    // Determinar el precio base según el tipo de viaje O servicio especial
    let baseFareToUse;
    if (servicioEspecialConfig.active) {
      // Si hay servicio especial, el precio base ES el costo del servicio (60 o 70)
      baseFareToUse = servicioEspecialConfig.cost;
    } else if (selectedTripType.id === 'cristoRey' && selectedSubTrip) {
      baseFareToUse = selectedSubTrip.fixedPrice;
    } else {
      baseFareToUse = selectedTripType.fixedPrice || RATES.baseFare;
    }

    // Cálculo por distancia
    let fare = baseFareToUse;

    if (selectedTripType.id !== 'normal') {
      // Para viajes diferentes a "Viaje Normal": precio base + 10 MXN por km después de 5 km
      if (distanceKm > 5) {
        const extraKmAfter5 = distanceKm - 5;
        fare += extraKmAfter5 * 10;
      }
    } else {
      // Para "Viaje Normal": usar la tabla de tarifas por distancia
      for (const rate of RATES.distanceRates) {
        if (distanceKm >= rate.min && distanceKm <= rate.max) {
          if (rate.extraRate && distanceKm > 8) {
            const extraKm = distanceKm - 8;
            const adjustedBasePrice = (rate.basePrice! - RATES.baseFare) + baseFareToUse;
            fare = adjustedBasePrice + (extraKm * rate.extraRate);
          } else {
            const priceIncrease = rate.price! - RATES.baseFare;
            fare = baseFareToUse + priceIncrease;
          }
          break;
        }
      }
    }

    return accumulatedStopsCost + fare + (waitingMinutes * RATES.waitingRate) + petExtraFee + personasExtrasFee + tripTypeExtraFee;
  }, [selectedTripType, selectedSubTrip, petConfig, servicioEspecialConfig, personasExtrasConfig, costoAcumuladoParadas, selectedSorianaZone]);
  // NOTA: Se ha agregado 'costoAcumuladoParadas' a las dependencias.

  // Formatear tiempo
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Manejar nueva posición GPS
  const handlePositionUpdate = useCallback((position: Position) => {
    setCurrentPosition(position);
    setGpsStatus('available');

    // Verificamos la referencia 'en vivo' del estado activo
    if (isActiveRef.current && !tripData.isPaused) {
      if (lastPositionRef.current) {
        // La distancia se calcula en metros para mayor precisión.
        const newDistanceMeters = calculateDistance(lastPositionRef.current, position);
        
        // Umbral más alto para filtrar mejor el "ruido" GPS y evitar cálculos prematuros
        const THRESHOLD = 15; // Aumentado de 5 a 15 metros
        if (newDistanceMeters > THRESHOLD) {
          // Convertimos a km para sumar al total
          const newDistanceKm = newDistanceMeters / 1000;
          setTripData(prev => {
            const rawTotalDistance = prev.rawDistance + newDistanceKm;
            
            // Aplicar descuento de 0.125 km por cada kilómetro completado
            const completedKm = Math.floor(rawTotalDistance);
            const discount = completedKm * 0.125;
            const adjustedDistance = Math.max(0, rawTotalDistance - discount);
            
            const waitingMinutes = Math.floor(prev.waitingTime / 60);
            return {
              ...prev,
              rawDistance: rawTotalDistance,
              distance: adjustedDistance,
              cost: calculateFare(adjustedDistance, waitingMinutes, isSorianaActive)
            };
          });
          // SOLO actualizar la última posición cuando realmente se registra movimiento
          lastPositionRef.current = position;
        }
      } else {
        // Primera posición después de iniciar - establecer como punto de referencia
        lastPositionRef.current = position;
      }
    }
  }, [calculateFare, tripData.isPaused, isSorianaActive]);

  // Inicializar GPS
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const position: Position = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            timestamp: Date.now()
          };
          setCurrentPosition(position);
          lastPositionRef.current = position;
          setGpsStatus('available');
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            setGpsStatus('denied');
          } else {
            setGpsStatus('unavailable');
          }
        },
        { enableHighAccuracy: true }
      );
    } else {
      setGpsStatus('unavailable');
    }
  }, []);

  // Iniciar contador de tiempo de espera
  const startWaitingTimer = () => {
    waitingStartTime.current = Date.now();
    waitingInterval.current = setInterval(() => {
      if (waitingStartTime.current) {
        const elapsed = Math.floor((Date.now() - waitingStartTime.current) / 1000);
        const currentWaitingTime = totalWaitingTime + elapsed;
        setTripData(prev => ({
          ...prev,
          waitingTime: currentWaitingTime
        }));
      }
    }, 1000);
  };

  // Detener contador de tiempo de espera
  const stopWaitingTimer = () => {
    if (waitingInterval.current) {
      clearInterval(waitingInterval.current);
      waitingInterval.current = null;
    }
    
    // Acumular el tiempo de espera cuando se detiene el timer
    if (waitingStartTime.current) {
      const elapsed = Math.floor((Date.now() - waitingStartTime.current) / 1000);
      setTotalWaitingTime(prev => prev + elapsed);
    }
    
    waitingStartTime.current = null;
  };

  // Iniciar taxímetro
  const startTrip = () => {
    if (currentPosition) {
      isActiveRef.current = true;
      // NO establecer lastPositionRef aquí - se establecerá en la primera actualización
      lastPositionRef.current = null;
      
      // Resetear tiempo de espera acumulado
      setTotalWaitingTime(0);
      
      setTripData(prev => ({
        ...prev,
        distance: 0, // Asegurar que siempre inicie en 0
        rawDistance: 0, // También resetear distancia cruda
        waitingTime: 0,
        isRunning: true,
        isPaused: false
      }));

      const id = navigator.geolocation.watchPosition(
        (pos) => {
          const position: Position = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            timestamp: Date.now()
          };
          handlePositionUpdate(position);
        },
        (error) => console.error('GPS Error:', error),
        {
          enableHighAccuracy: true,
          maximumAge: 500,
          timeout: 10000
        }
      );
      setWatchId(id);
    }
  };

  // Pausar/Reanudar taxímetro
  const togglePause = () => {
    setTripData(prev => {
      const newPaused = !prev.isPaused;
      
      if (newPaused) {
        // Pausar - iniciar contador de espera
        startWaitingTimer();
      } else {
        // Reanudar - detener contador de espera
        stopWaitingTimer();
      }
      
      return {
        ...prev,
        isPaused: newPaused
      };
    });
  };

  // Detener taxímetro
  const stopTrip = () => {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
    }

    stopWaitingTimer();
    
    // Crear resumen del viaje (capturar estado de extras antes de resetear)
    const summary: TripSummary = {
      tripType: selectedTripType.name,
      distance: tripData.distance,
      waitingTime: tripData.waitingTime,
      cost: tripData.cost, // <--- ESTE VALOR YA INCLUYE EL costoAcumuladoParadas GRACIAS AL ULTIMO useEffect
      timestamp: new Date().toLocaleString(),
      isSorianaActive: isSorianaActive,
      petConfig: { ...petConfig },
      servicioEspecialConfig: { ...servicioEspecialConfig },
      personasExtrasConfig: { ...personasExtrasConfig },
      numeroParadas: numeroParadas,
      costoParadas: costoAcumuladoParadas // <--- GUARDAMOS EL COSTO DE PARADAS PARA EL DESGLOSE
    };
    
    setLastTripSummary(summary);
    setShowSummary(true);
    
    // Resetear datos del viaje
    isActiveRef.current = false;
    setTotalWaitingTime(0);
    
    // **CORRECCIÓN 1 Y 2: Reiniciar el tipo de viaje a "Viaje Altar Mayor" y el costo a la tarifa base.**
    const initialTripType = TRIP_TYPES[0];
    setSelectedTripType(initialTripType);
    setSelectedSubTrip(null);

    setTripData({
      distance: 0,
      rawDistance: 0,
      cost: RATES.baseFare, // Siempre a 50 MXN (tarifa base inicial)
      waitingTime: 0,
      isRunning: false,
      isPaused: false
    });

    // Resetear extras
    setServiciosExtrasActive(false);
    setPetConfig({
      active: false,
      withCage: null,
      cost: 0
    });
    setServicioEspecialConfig({
      active: false,
      type: null,
      cost: 0
    });
    setPersonasExtrasConfig({
      active: false,
      ninos: 0,
      adultos: 0,
      cost: 0
    });
    setIsSorianaActive(false);
    setSelectedSorianaZone(null);
    setCostoAcumuladoParadas(0);
    setNumeroParadas(0);

    lastPositionRef.current = currentPosition;
  };

  // Función para iniciar/detener simulación
  const toggleSimulation = () => {
    if (isSimulating) {
      if (simulationInterval.current) {
        clearInterval(simulationInterval.current);
        simulationInterval.current = null;
      }
      setIsSimulating(false);
    } else {
      setIsSimulating(true);
      simulationInterval.current = setInterval(() => {
        setTripData(prev => {
          const newDistance = prev.distance + 0.1;
          const waitingMinutes = Math.floor(prev.waitingTime / 60);
          return {
            ...prev,
            distance: newDistance,
            rawDistance: newDistance,
            cost: calculateFare(newDistance, waitingMinutes, isSorianaActive)
          };
        });
      }, 1000);
    }
  };

  // Limpiar simulación al desmontar
  useEffect(() => {
    return () => {
      if (simulationInterval.current) {
        clearInterval(simulationInterval.current);
      }
    };
  }, []);

  // Efecto para actualizar el costo cuando cambia el tipo de viaje (solo si no está corriendo)
  useEffect(() => {
    if (!tripData.isRunning) {
      // Recalcular el costo inicial usando la base + cualquier extra activo (como paradas anteriores)
      const waitingMinutes = Math.floor(tripData.waitingTime / 60);
      setTripData(prev => ({
        ...prev,
        cost: calculateFare(prev.distance, waitingMinutes, isSorianaActive)
      }));
    }
  }, [selectedTripType, selectedSubTrip, tripData.isRunning, calculateFare, isSorianaActive, tripData.distance, tripData.waitingTime]);

  // Efecto para actualizar el costo cuando cambia el tiempo de espera
  useEffect(() => {
    if (tripData.isRunning) {
      const waitingMinutes = Math.floor(tripData.waitingTime / 60);
      setTripData(prev => ({
        ...prev,
        cost: calculateFare(prev.distance, waitingMinutes, isSorianaActive)
      }));
    }
  }, [calculateFare, tripData.waitingTime, tripData.isRunning, isSorianaActive]);
  
  // Efecto CLAVE para actualizar el costo total cuando cambia CUALQUIER EXTRA (Incluyendo Paradas)
  // Este useEffect garantiza que tripData.cost siempre esté actualizado con costoAcumuladoParadas
  useEffect(() => {
    if (personasExtrasConfig.active || tripData.isRunning || petConfig.active || servicioEspecialConfig.active || isSorianaActive || costoAcumuladoParadas > 0) {
      const waitingMinutes = Math.floor(tripData.waitingTime / 60);
      setTripData(prev => ({
        ...prev,
        cost: calculateFare(prev.distance, waitingMinutes, isSorianaActive)
      }));
    }
  }, [calculateFare, personasExtrasConfig, petConfig, servicioEspecialConfig, isSorianaActive, costoAcumuladoParadas, tripData.isRunning, tripData.distance, tripData.waitingTime]);

  // Cargar ganancias del día desde Firestore al iniciar sesión
  useEffect(() => {
    const loadDailyEarnings = async () => {
      try {
        const user = auth.currentUser;
        if (user) {
          const today = new Date().toISOString().split('T')[0];
          const earningsRef = doc(db, 'gananciasDiarias', `${user.uid}_${today}`);
          const docSnapshot = await getDoc(earningsRef);

          if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            setDailyEarnings(data.totalGanancias || 0);
          }
        }
      } catch (error) {
        console.error('Error al cargar ganancias del día:', error);
      }
    };

    loadDailyEarnings();
  }, []);

  // Función para generar lista de meses disponibles (últimos 12 meses)
  const generateAvailableMonths = () => {
    const months = [];
    const meses = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
    const now = new Date();

    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = `${meses[date.getMonth()]}_${date.getFullYear()}`;
      months.push(monthName);
    }

    return months;
  };

  // Cargar datos de un mes específico
  const loadMonthlyData = async (monthName: string) => {
    try {
      const user = auth.currentUser;
      if (user && monthName) {
        const userDocRef = doc(db, 'bitacora_ganancias', user.uid);
        const mesSubcollectionRef = collection(userDocRef, monthName);
        const q = query(mesSubcollectionRef, orderBy('dia', 'asc'));
        const querySnapshot = await getDocs(q);

        const data: Array<{dia: number, ganancia: number}> = [];
        querySnapshot.forEach((doc) => {
          const docData = doc.data();
          data.push({
            dia: docData.dia,
            ganancia: docData.ganancia || 0
          });
        });

        setMonthlyEarningsData(data);
      }
    } catch (error) {
      console.error('Error al cargar datos mensuales:', error);
      setMonthlyEarningsData([]);
    }
  };

  // **Funciones para manejar el incremento/decremento de pasajeros**
  const handlePassengerChange = (type: 'adultos' | 'ninos', delta: 1 | -1) => {
    setPersonasExtrasConfig(prev => {
      const newValue = Math.max(0, prev[type] + delta);
      const newAdultos = type === 'adultos' ? newValue : prev.adultos;
      const newNinos = type === 'ninos' ? newValue : prev.ninos;
      
      // Calcular el nuevo costo
      const newCost = (newAdultos * 20) + (newNinos * 10);
      
      return {
        active: (newAdultos > 0 || newNinos > 0),
        adultos: newAdultos,
        ninos: newNinos,
        cost: newCost
      };
    });
  };

  // Funciones de estado
  const getStatusColor = () => {
    if (tripData.isRunning) {
      return tripData.isPaused ? 'bg-yellow-400' : 'bg-green-500';
    }
    return gpsStatus === 'available' ? 'bg-blue-400' : 'bg-red-500';
  };

  const getStatusText = () => {
    if (tripData.isRunning) {
      return tripData.isPaused ? 'EN PAUSA - ESPERANDO' : 'VIAJE EN CURSO';
    }
    switch (gpsStatus) {
      case 'available': return 'GPS DISPONIBLE';
      case 'requesting': return 'BUSCANDO SEÑAL GPS...';
      case 'denied': return 'ACCESO GPS DENEGADO';
      case 'unavailable': return 'GPS NO DISPONIBLE';
      default: return 'ESTADO DESCONOCIDO';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4 font-sans text-white">
      {/* Botón Flotante de Ganancias del Día */}
      <button
        onClick={() => setShowEarningsModal(true)}
        className="fixed bottom-6 right-6 w-16 h-16 bg-green-600 hover:bg-green-500 text-white rounded-full shadow-lg flex items-center justify-center font-bold text-lg transition duration-200 z-40 border-2 border-green-400"
      >
        ${dailyEarnings.toFixed(0)}
      </button>

      {/* Botón Flotante de Ganancias Mensuales */}
      <button
        onClick={() => {
          setAvailableMonths(generateAvailableMonths());
          setShowMonthlyEarningsModal(true);
        }}
        className="fixed bottom-24 right-6 w-16 h-16 bg-blue-700 hover:bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center transition duration-200 z-40 border-2 border-blue-500"
      >
        <Calendar className="w-8 h-8" />
      </button>

      <div className="max-w-md mx-auto">
        {/* Modal de Ganancias del Día */}
        {showEarningsModal && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-green-500 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-white">Ganancias del Día</h2>
                <button
                  onClick={() => setShowEarningsModal(false)}
                  className="text-gray-400 hover:text-white text-2xl"
                >
                  ×
                </button>
              </div>
              <div className="bg-gray-700 border border-green-500/50 p-6 rounded-lg mb-6 text-center">
                <p className="text-gray-300 text-sm mb-2">Total Acumulado</p>
                <p className="text-5xl font-extrabold text-green-400">
                  ${dailyEarnings.toFixed(0)}
                  <span className="text-lg text-gray-400 ml-2">MXN</span>
                </p>
              </div>
              <button
                onClick={async () => {
                  try {
                    const user = auth.currentUser;
                    if (user && dailyEarnings > 0) {
                      const now = new Date();
                      const meses = [
                        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
                      ];

                      const nombreMes = `${meses[now.getMonth()]}_${now.getFullYear()}`;
                      const userDocRef = doc(db, 'bitacora_ganancias', user.uid);
                      const mesSubcollectionRef = collection(userDocRef, nombreMes);

                      await addDoc(mesSubcollectionRef, {
                        dia: now.getDate(),
                        fecha_cierre: serverTimestamp(),
                        ganancia: dailyEarnings
                      });

                      const today = new Date().toISOString().split('T')[0];
                      const earningsRef = doc(db, 'gananciasDiarias', `${user.uid}_${today}`);
                      await setDoc(earningsRef, {
                        userId: user.uid,
                        fecha: today,
                        totalGanancias: 0,
                        ultimaActualizacion: serverTimestamp()
                      }, { merge: true });
                    }

                    setDailyEarnings(0);
                    setShowEarningsModal(false);
                  } catch (error) {
                    console.error('Error al guardar bitácora:', error);
                  }
                }}
                className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded-xl transition duration-200 mb-2"
              >
                Terminar Día
              </button>
              <button
                onClick={() => setShowEarningsModal(false)}
                className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 rounded-xl transition duration-200"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* Modal de Ganancias Mensuales */}
        {showMonthlyEarningsModal && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-blue-500 rounded-xl p-4 max-w-md w-full shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-bold text-white">Ganancias Mensuales</h2>
                <button
                  onClick={() => {
                    setShowMonthlyEarningsModal(false);
                    setSelectedMonth('');
                    setMonthlyEarningsData([]);
                  }}
                  className="text-gray-400 hover:text-white text-2xl"
                >
                  ×
                </button>
              </div>

              <div className="mb-3">
                <label className="block text-gray-300 text-xs mb-1">Selecciona el mes:</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(e.target.value);
                    if (e.target.value) {
                      loadMonthlyData(e.target.value);
                    } else {
                      setMonthlyEarningsData([]);
                    }
                  }}
                  className="w-full bg-gray-700 text-white p-2 rounded-lg border border-gray-600 text-sm"
                >
                  <option value="">-- Selecciona un mes --</option>
                  {availableMonths.map((month) => (
                    <option key={month} value={month}>
                      {month.replace('_', ' ').toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              {selectedMonth && (
                <>
                  <div className="bg-gray-700 border border-blue-500/50 p-3 rounded-lg mb-3">
                    <p className="text-gray-300 text-xs mb-1 text-center">Total del Mes</p>
                    <p className="text-3xl font-extrabold text-blue-400 text-center">
                      ${monthlyEarningsData.reduce((sum, item) => sum + item.ganancia, 0).toFixed(0)}
                      <span className="text-sm text-gray-400 ml-1">MXN</span>
                    </p>
                  </div>

                  <div className="bg-gray-700 border border-gray-600 rounded-lg p-3 flex-1 overflow-hidden flex flex-col">
                    <h3 className="text-white font-bold mb-2 text-center text-sm">Ganancias por Día</h3>
                    {monthlyEarningsData.length > 0 ? (
                      <div className="overflow-y-auto flex-1 pr-2">
                        <div className="grid grid-cols-2 gap-2">
                          {monthlyEarningsData.map((item, index) => (
                            <div
                              key={index}
                              className="bg-gray-800 p-2 rounded border border-gray-600 hover:border-blue-500 transition text-center"
                            >
                              <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-1">
                                <span className="text-white font-bold text-xs">{item.dia}</span>
                              </div>
                              <span className="text-green-400 font-bold text-xs block">${item.ganancia.toFixed(0)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-400 text-center text-xs py-2">No hay datos para este mes</p>
                    )}
                  </div>
                </>
              )}

              <button
                onClick={() => {
                  setShowMonthlyEarningsModal(false);
                  setSelectedMonth('');
                  setMonthlyEarningsData([]);
                }}
                className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 rounded-xl transition duration-200 mt-3 text-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* Modal de Foraneos */}
        {showForaneosModal && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-blue-500 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-white">Precios Foráneos</h2>
                <button
                  onClick={() => setShowForaneosModal(false)}
                  className="text-gray-400 hover:text-white text-2xl"
                >
                  ×
                </button>
              </div>
              <p className="text-gray-300 mb-6 text-center">Consulta los precios para viajes foráneos</p>
              <a
                href="https://precios.speedcabszapotlan.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition duration-200 shadow-lg block text-center mb-3"
              >
                Abrir Precios Foráneos
              </a>
              <button
                onClick={() => setShowForaneosModal(false)}
                className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 rounded-xl transition duration-200"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* Modal de resumen del viaje (Se mantiene igual) */}
        {showSummary && lastTripSummary && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-blue-500 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center justify-center mb-4">
                <MapPinned className="w-8 h-8 text-blue-400 mr-2" />
                <h2 className="text-2xl font-bold text-center text-white">
                  Resumen del Viaje
                </h2>
              </div>
              
              <div className="space-y-4">
                <div className="bg-gray-700 border border-gray-600 p-3 rounded-lg">
                  <div className="text-center">
                    <span className="text-blue-400 font-bold text-lg">{lastTripSummary.tripType}</span>
                  </div>
                </div>

                <div className="bg-gray-700 border border-gray-600 p-4 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-300">Distancia recorrida:</span>
                    <span className="font-bold text-lg text-blue-400">{lastTripSummary.distance.toFixed(3)} km</span>
                  </div>

                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-300">Tiempo de espera:</span>
                    <span className="font-bold text-lg text-blue-400">{formatTime(lastTripSummary.waitingTime)}</span>
                  </div>

                  <div className="border-t border-gray-600 pt-3 mt-3">
                    <div className="space-y-2 mb-2">
                      {(() => {
                        const waitingMinutes = Math.floor(lastTripSummary.waitingTime / 60);
                        const waitingCost = waitingMinutes * RATES.waitingRate;
                        const petCost = lastTripSummary.petConfig.active ? lastTripSummary.petConfig.cost : 0;
                        const personasExtrasCost = lastTripSummary.personasExtrasConfig.active ? lastTripSummary.personasExtrasConfig.cost : 0;

                        // Si es zona lejana de Soriana, el costo es fijo de $70
                        const hadSpecialZone = lastTripSummary.isSorianaActive &&
                          Math.abs(lastTripSummary.cost - (70 + lastTripSummary.costoParadas + waitingCost + petCost + personasExtrasCost)) < 1;

                        if (hadSpecialZone) {
                          return (
                            <>
                              {lastTripSummary.numeroParadas > 0 && (
                                <div className="flex justify-between items-center text-sm bg-blue-900/30 p-2 rounded">
                                  <span className="text-blue-300">Paradas ({lastTripSummary.numeroParadas}):</span>
                                  <span className="text-white font-semibold">${lastTripSummary.costoParadas} MXN</span>
                                </div>
                              )}
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Zona especial (tarifa fija):</span>
                                <span className="text-white font-semibold">$70 MXN</span>
                              </div>
                              {waitingCost > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                  <span className="text-gray-300">Tiempo de espera:</span>
                                  <span className="text-white font-semibold">${waitingCost.toFixed(0)} MXN</span>
                                </div>
                              )}
                              {petCost > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                  <span className="text-gray-300">Mascota:</span>
                                  <span className="text-white font-semibold">${petCost} MXN</span>
                                </div>
                              )}
                              {personasExtrasCost > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                  <span className="text-gray-300">Pasajeros adicionales:</span>
                                  <span className="text-white font-semibold">${personasExtrasCost} MXN</span>
                                </div>
                              )}
                            </>
                          );
                        }

                        // --- Lógica para Viaje Normal / Otras rutas ---

                        let baseFareToUse;
                        if (lastTripSummary.servicioEspecialConfig.active) {
                          baseFareToUse = lastTripSummary.servicioEspecialConfig.cost;
                        } else if (lastTripSummary.tripType.includes('Cristo Rey')) {
                          baseFareToUse = (TRIP_TYPES.find(t => t.name === lastTripSummary.tripType)?.subTrips?.find(st => st.name === lastTripSummary.tripType)?.fixedPrice || RATES.baseFare);
                        } else {
                          baseFareToUse = (TRIP_TYPES.find(t => t.name === lastTripSummary.tripType)?.fixedPrice || RATES.baseFare);
                        }

                        let baseCost = baseFareToUse;
                        let tripTypeExtraFee = 0;

                        // Recalcular baseCost solo para desglose (ya que el total es lastTripSummary.cost)
                        if (lastTripSummary.tripType.includes('Colmena')) {
                            if (lastTripSummary.distance > 4.9) {
                                const kmExtra = lastTripSummary.distance - 4.9;
                                baseCost = 120 + (Math.ceil(kmExtra) * 10);
                            } else {
                                baseCost = 120;
                            }
                        }
                        else if (lastTripSummary.tripType !== 'Viaje Normal') {
                          if (lastTripSummary.distance > 5) {
                            const extraKmAfter5 = lastTripSummary.distance - 5;
                            baseCost += extraKmAfter5 * 10;
                          }
                        } else {
                          for (const rate of RATES.distanceRates) {
                            if (lastTripSummary.distance >= rate.min && lastTripSummary.distance <= rate.max) {
                              if (rate.extraRate && lastTripSummary.distance > 8) {
                                const extraKm = lastTripSummary.distance - 8;
                                const adjustedBasePrice = (rate.basePrice! - RATES.baseFare) + baseFareToUse;
                                baseCost = adjustedBasePrice + (extraKm * rate.extraRate);
                              } else {
                                const priceIncrease = rate.price! - RATES.baseFare;
                                baseCost = baseFareToUse + priceIncrease;
                              }
                              break;
                            }
                          }
                        }

                        if ((lastTripSummary.tripType !== 'Viaje Normal' || (lastTripSummary.isSorianaActive && !lastTripSummary.costoParadas)) && lastTripSummary.distance >= 3.7) {
                          tripTypeExtraFee = 5;
                        }

                        const calculatedBaseFareForDisplay = lastTripSummary.cost - lastTripSummary.costoParadas - waitingCost - petCost - personasExtrasCost - tripTypeExtraFee;

                        return (
                          <>
                            {lastTripSummary.numeroParadas > 0 && (
                              <div className="flex justify-between items-center text-sm bg-blue-900/30 p-2 rounded">
                                <span className="text-blue-300">Paradas ({lastTripSummary.numeroParadas}):</span>
                                <span className="text-white font-semibold">${lastTripSummary.costoParadas} MXN</span>
                              </div>
                            )}
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-300">Tarifa de ruta:</span>
                              <span className="text-white font-semibold">${calculatedBaseFareForDisplay.toFixed(2)} MXN</span>
                            </div>
                            {waitingCost > 0 && (
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Tiempo de espera:</span>
                                <span className="text-white font-semibold">${waitingCost.toFixed(0)} MXN</span>
                              </div>
                            )}
                            {petCost > 0 && (
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Mascota:</span>
                                <span className="text-white font-semibold">${petCost} MXN</span>
                              </div>
                            )}
                            {personasExtrasCost > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Pasajeros adicionales:</span>
                                <span className="text-white font-semibold">${personasExtrasCost} MXN</span>
                              </div>
                            )}
                            {tripTypeExtraFee > 0 && (
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Cargo adicional (&gt;3.7 km):</span>
                                <span className="text-white font-semibold">${tripTypeExtraFee} MXN</span>
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {/* Total */}
                      <div className="flex justify-between items-center mt-3 border-t border-blue-500/50 pt-3">
                        <span className="text-xl text-white">TOTAL:</span>
                        <span className="text-3xl font-extrabold text-blue-400">${lastTripSummary.cost.toFixed(0)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={async () => {
                    const newEarnings = dailyEarnings + lastTripSummary.cost;
                    setDailyEarnings(newEarnings);

                    try {
                      const user = auth.currentUser;
                      if (user) {
                        const today = new Date().toISOString().split('T')[0];
                        const earningsRef = doc(db, 'gananciasDiarias', `${user.uid}_${today}`);
                        await setDoc(earningsRef, {
                          userId: user.uid,
                          fecha: today,
                          totalGanancias: newEarnings,
                          ultimaActualizacion: serverTimestamp()
                        }, { merge: true });
                      }
                    } catch (error) {
                      console.error('Error al guardar ganancias:', error);
                    }

                    setShowSummary(false);
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition duration-200 shadow-lg"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="mb-6">
          <h1 className="text-4xl font-extrabold text-white text-center mb-1 flex items-center justify-center">
            <Gauge className="w-8 h-8 text-blue-400 mr-2" />
            Recorrido GPS
          </h1>
          <div className={`text-center py-1.5 px-3 rounded-full text-sm font-semibold text-gray-900 ${getStatusColor()}`}>
            <MapPin className="w-4 h-4 inline-block mr-1" />
            {getStatusText()}
          </div>
          <div className="mt-3 text-center">
            <button
              onClick={() => setShowForaneosModal(true)}
              className="inline-block bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg transition duration-200"
            >
              Foraneos
            </button>
          </div>
        </header>

        {/* Display Principal */}
        <div className="bg-gray-800 p-6 rounded-2xl shadow-2xl mb-6 border border-gray-700">
          <div className="flex justify-between items-end mb-4">
            <div className="text-left">
              <span className="text-xs font-medium text-blue-400 uppercase">Distancia Recorrida</span>
              <p className="text-4xl font-bold text-white leading-none">
                {tripData.distance.toFixed(3)}
                <span className="text-lg font-normal text-gray-400 ml-1">km</span>
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs font-medium text-blue-400 uppercase">Tiempo de Espera</span>
              <p className="text-2xl font-bold text-white leading-none">
                {formatTime(tripData.waitingTime)}
              </p>
            </div>
          </div>

          <div className="text-center bg-black/50 p-3 rounded-xl border border-blue-500/50">
            <span className="text-xs font-medium text-blue-400 uppercase block">Tarifa Total</span>
            <p className="text-6xl font-extrabold text-blue-400 mt-1">
              ${Math.ceil(tripData.cost).toFixed(0)}
              <span className="text-xl font-normal text-gray-400 ml-1">MXN</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">
              (Tarifa Base: ${getBasePrice(selectedTripType).toFixed(2)})
            </p>
          </div>
        </div>

        {/* Controles de Viaje (Se mantiene igual) */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {tripData.isRunning ? (
            <>
              {/* Botón de Pausa/Reanudar */}
              <button
                onClick={togglePause}
                className={`flex flex-col items-center justify-center p-3 rounded-xl shadow-lg transition duration-200 ${tripData.isPaused ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-blue-600 hover:bg-blue-500'}`}
              >
                {tripData.isPaused ? (
                  <Play className="w-6 h-6 text-white" />
                ) : (
                  <Pause className="w-6 h-6 text-white" />
                )}
                <span className="text-xs mt-1 font-bold text-white">
                  {tripData.isPaused ? 'Reanudar' : 'Pausar'}
                </span>
              </button>

              {/* Botón de Finalizar Viaje */}
              <button
                onClick={stopTrip}
                className="flex flex-col items-center justify-center p-3 rounded-xl bg-red-600 hover:bg-red-500 text-white shadow-lg transition duration-200"
              >
                <Square className="w-6 h-6" />
                <span className="text-xs mt-1 font-bold">Finalizar</span>
              </button>

              {/* Botón de Simulación */}
              <button
                onClick={toggleSimulation}
                className={`flex flex-col items-center justify-center p-3 rounded-xl shadow-lg transition duration-200 ${isSimulating ? 'bg-green-600 hover:bg-green-500' : 'bg-gray-600 hover:bg-gray-500'} text-white`}
              >
                <Zap className="w-6 h-6" />
                <span className="text-xs mt-1 font-bold">
                  {isSimulating ? 'SIMULANDO' : 'Simular'}
                </span>
              </button>
            </>
          ) : (
            <>
              {/* Botón de Iniciar Viaje */}
              <button
                onClick={startTrip}
                className={`col-span-2 flex flex-col items-center justify-center p-3 rounded-xl shadow-lg transition duration-200 ${gpsStatus === 'available' ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-gray-600 text-gray-300 cursor-not-allowed'}`}
                disabled={gpsStatus !== 'available'}
              >
                <Play className="w-8 h-8" />
                <span className="text-md mt-1 font-bold">INICIAR VIAJE</span>
              </button>

              {/* Botón de Simulación (en modo inactivo) */}
              <button
                onClick={toggleSimulation}
                className={`flex flex-col items-center justify-center p-3 rounded-xl shadow-lg transition duration-200 ${isSimulating ? 'bg-green-600 hover:bg-green-500' : 'bg-gray-600 hover:bg-gray-500'} text-white`}
              >
                <Zap className="w-6 h-6" />
                <span className="text-xs mt-1 font-bold">
                  {isSimulating ? 'SIMULANDO' : 'Simular'}
                </span>
              </button>
            </>
          )}
        </div>

        {/* Paradas Intermedias */}
        {tripData.isRunning && (
          <div className="bg-gray-800 p-4 rounded-xl shadow-lg mb-6 border border-gray-700 relative">
            <h3 className="text-lg font-bold text-white mb-2 flex items-center">
              <MapPinned className="w-5 h-5 text-blue-400 mr-2" />
              Paradas
            </h3>
            <div className="flex justify-between items-center text-sm mb-2">
              <span className="text-gray-300">Número de paradas:</span>
              <span className="font-bold text-white">{numeroParadas}</span>
            </div>
            <div className="flex justify-between items-center text-sm mb-4">
              <span className="text-gray-300">Costo acumulado:</span>
              <span className="font-bold text-blue-400">${costoAcumuladoParadas.toFixed(0)} MXN</span>
            </div>

            <button
              onClick={() => setShowParadaSelector(true)}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-xl transition duration-200"
              disabled={showParadaSelector}
            >
              Añadir Parada
            </button>
            
            {/* Selector de Tipo de Parada (Modal/Panel) */}
            {showParadaSelector && (
              <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-4 rounded-xl z-10">
                <div className="bg-gray-700 p-4 rounded-lg w-full max-w-xs shadow-2xl border border-blue-500/50">
                  <h4 className="text-lg font-bold text-white mb-3 text-center">Tipo de Parada:</h4>
                  <div className="space-y-3">
                    <button
                      onClick={() => handleParadaAdd(RATES.paradaRapida)}
                      className="w-full flex items-center justify-between p-3 rounded-lg bg-green-600 hover:bg-green-500 text-white font-bold transition duration-150"
                    >
                      <FastForward className="w-5 h-5" />
                      <span className="text-sm">Parada Rápida</span>
                      <span className="text-lg font-extrabold">+${RATES.paradaRapida}</span>
                    </button>
                    <button
                      onClick={() => handleParadaAdd(RATES.paradaServicio, true)}
                      className="w-full flex items-center justify-between p-3 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white font-bold transition duration-150"
                    >
                      <ShoppingBag className="w-5 h-5" />
                      <span className="text-sm">Parada con Servicio</span>
                      <span className="text-lg font-extrabold">+${RATES.paradaServicio}</span>
                    </button>
                  </div>
                  <button
                    onClick={() => setShowParadaSelector(false)}
                    className="w-full mt-4 bg-gray-500 hover:bg-gray-600 text-white text-sm py-2 rounded-lg"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Sección de Servicios Extras */}
        <div className="bg-gray-800 p-4 rounded-xl shadow-lg mb-6 border border-gray-700">
          <div className="flex justify-between items-center cursor-pointer" onClick={() => setShowExtrasSelector(prev => !prev)}>
            <div className="flex items-center">
              <DollarSign className="w-5 h-5 text-blue-400 mr-2" />
              <span className="text-sm font-medium text-gray-300">Servicios Adicionales</span>
            </div>
            {showExtrasSelector ? <ChevronUp className="w-5 h-5 text-white" /> : <ChevronDown className="w-5 h-5 text-white" />}
          </div>

          {showExtrasSelector && (
            <div className="mt-3 border-t border-gray-700 pt-3 space-y-3">
              {/* Pet Selector */}
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <span className="text-sm text-white">Mascota (+${petConfig.withCage ? 20 : 30} MXN)</span>
                </div>
                <button
                  onClick={() => setShowPetSelector(prev => !prev)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${petConfig.active ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                  disabled={tripData.isRunning}
                >
                  {petConfig.active ? 'Activo' : 'Añadir'}
                </button>
              </div>

              {/* Pet Configuration Modal/Panel */}
              {showPetSelector && (
                <div className="bg-gray-700 p-3 rounded-lg space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-300">¿Con jaula/transportadora?</span>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => {
                          setPetConfig({ active: true, withCage: true, cost: 20 });
                          setShowPetSelector(false);
                        }}
                        className={`px-3 py-1 text-xs rounded-full ${petConfig.withCage === true ? 'bg-blue-500 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                        disabled={tripData.isRunning}
                      >
                        Sí ($20)
                      </button>
                      <button
                        onClick={() => {
                          setPetConfig({ active: true, withCage: false, cost: 30 });
                          setShowPetSelector(false);
                        }}
                        className={`px-3 py-1 text-xs rounded-full ${petConfig.withCage === false ? 'bg-red-500 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                        disabled={tripData.isRunning}
                      >
                        No ($30)
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setPetConfig({ active: false, withCage: null, cost: 0 });
                      setShowPetSelector(false);
                    }}
                    className="w-full bg-red-700 text-white text-xs py-1 rounded"
                    disabled={tripData.isRunning}
                  >
                    Eliminar
                  </button>
                </div>
              )}

              {/* Servicio Especial Selector */}
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <span className="text-sm text-white">Servicio Especial (Recoger +$60 / Comprar +$70)</span>
                </div>
                <button
                  onClick={() => setShowServicioEspecialSelector(prev => !prev)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${servicioEspecialConfig.active ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                  disabled={tripData.isRunning}
                >
                  {servicioEspecialConfig.active ? 'Activo' : 'Añadir'}
                </button>
              </div>

              {/* Servicio Especial Configuration Modal/Panel */}
              {showServicioEspecialSelector && (
                <div className="bg-gray-700 p-3 rounded-lg space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-300">Selecciona tipo de servicio:</span>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => {
                          setServicioEspecialConfig({ active: true, type: 'recoger', cost: 60 });
                          setShowServicioEspecialSelector(false);
                        }}
                        className={`px-3 py-1 text-xs rounded-full ${servicioEspecialConfig.type === 'recoger' ? 'bg-blue-500 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                        disabled={tripData.isRunning}
                      >
                        Recoger ($60)
                      </button>
                      <button
                        onClick={() => {
                          setServicioEspecialConfig({ active: true, type: 'comprar', cost: 70 });
                          setShowServicioEspecialSelector(false);
                        }}
                        className={`px-3 py-1 text-xs rounded-full ${servicioEspecialConfig.type === 'comprar' ? 'bg-blue-500 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                        disabled={tripData.isRunning}
                      >
                        Comprar ($70)
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setServicioEspecialConfig({ active: false, type: null, cost: 0 });
                      setShowServicioEspecialSelector(false);
                    }}
                    className="w-full bg-red-700 text-white text-xs py-1 rounded"
                    disabled={tripData.isRunning}
                  >
                    Eliminar
                  </button>
                </div>
              )}

              {/* Personas Extras Selector */}
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <span className="text-sm text-white">Pasajeros Adicionales (+ $20/Adulto, $10/Niño)</span>
                </div>
                <button
                  onClick={() => setShowPersonasExtrasSelector(prev => !prev)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${personasExtrasConfig.active ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                  disabled={tripData.isRunning}
                >
                  {personasExtrasConfig.active ? 'Activo' : 'Añadir'}
                </button>
              </div>

              {/* Personas Extras Configuration Panel */}
              {showPersonasExtrasSelector && (
                <div className="bg-gray-700 p-3 rounded-lg space-y-2">

                  {/* Control de Adultos */}
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-300">Adultos ($20 c/u):</span>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handlePassengerChange('adultos', -1)}
                        className={`p-1 rounded-full transition ${personasExtrasConfig.adultos > 0 && !tripData.isRunning ? 'bg-red-500 hover:bg-red-400' : 'bg-gray-600 cursor-not-allowed'}`}
                        disabled={personasExtrasConfig.adultos === 0 || tripData.isRunning}
                      >
                        <Minus className="w-4 h-4 text-white" />
                      </button>
                      <span className="w-6 text-center text-white font-bold text-sm">
                        {personasExtrasConfig.adultos}
                      </span>
                      <button
                        onClick={() => handlePassengerChange('adultos', 1)}
                        className={`p-1 rounded-full transition ${!tripData.isRunning ? 'bg-green-500 hover:bg-green-400' : 'bg-gray-600 cursor-not-allowed'}`}
                        disabled={tripData.isRunning}
                      >
                        <Plus className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  </div>

                  {/* Control de Niños */}
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-300">Niños ($10 c/u):</span>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handlePassengerChange('ninos', -1)}
                        className={`p-1 rounded-full transition ${personasExtrasConfig.ninos > 0 && !tripData.isRunning ? 'bg-red-500 hover:bg-red-400' : 'bg-gray-600 cursor-not-allowed'}`}
                        disabled={personasExtrasConfig.ninos === 0 || tripData.isRunning}
                      >
                        <Minus className="w-4 h-4 text-white" />
                      </button>
                      <span className="w-6 text-center text-white font-bold text-sm">
                        {personasExtrasConfig.ninos}
                      </span>
                      <button
                        onClick={() => handlePassengerChange('ninos', 1)}
                        className={`p-1 rounded-full transition ${!tripData.isRunning ? 'bg-green-500 hover:bg-green-400' : 'bg-gray-600 cursor-not-allowed'}`}
                        disabled={tripData.isRunning}
                      >
                        <Plus className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  </div>

                  <p className="text-right text-sm font-bold text-blue-400">Costo adicional: ${personasExtrasConfig.cost} MXN</p>
                  <button
                    onClick={() => setShowPersonasExtrasSelector(false)}
                    className="w-full bg-blue-700 text-white text-xs py-1 rounded"
                  >
                    Guardar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sección de Tipo de Viaje (DESHABILITADA) */}
        <div className="bg-gray-800 p-4 rounded-xl shadow-lg mb-6 border border-gray-700 opacity-50 pointer-events-none">
          <div className="flex justify-between items-center cursor-pointer">
            <div className="flex items-center">
              <Car className="w-5 h-5 text-blue-400 mr-2" />
              <span className="text-sm font-medium text-gray-300">Tipo de Ruta:</span>
            </div>
            <div className="flex items-center">
              <span className="text-md font-bold text-white mr-2">{selectedTripType.name}</span>
              <ChevronDown className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>

        {/* Checkbox de Zona Especial (DESHABILITADA) */}
        <div className="bg-gray-800 p-4 rounded-xl shadow-lg mb-6 border border-gray-700 opacity-50 pointer-events-none">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <Navigation className="w-5 h-5 text-blue-400 mr-2" />
              <span className="text-sm font-medium text-gray-300">Zona Especial (Tarifa fija $70)</span>
            </div>
            <input
              type="checkbox"
              checked={isSorianaActive}
              onChange={() => {} }
              className="form-checkbox h-5 w-5 text-red-600 bg-gray-700 border-gray-600 rounded"
              disabled
            />
          </div>
        </div>

        {/* Sección de Tarifas */}
        <div className="bg-gray-800 p-4 rounded-xl shadow-lg mb-6 border border-gray-700">
          <div className="flex justify-between items-center cursor-pointer" onClick={() => setShowRates(prev => !prev)}>
            <div className="flex items-center">
              <Info className="w-5 h-5 text-gray-400 mr-2" />
              <span className="text-sm font-medium text-gray-300">Información de Tarifas</span>
            </div>
            {showRates ? <ChevronUp className="w-5 h-5 text-white" /> : <ChevronDown className="w-5 h-5 text-white" />}
          </div>

          {showRates && (
            <div className="mt-3 border-t border-gray-700 pt-3 space-y-3 text-sm text-gray-300">
              <p className="font-bold text-white">Tarifa Base: ${RATES.baseFare} MXN</p>
              <p className="font-bold text-white">Costo por Tiempo de Espera: ${RATES.waitingRate} MXN/min</p>

              <h4 className="font-bold text-blue-400 mt-3">Tarifas por Distancia (Viaje Normal):</h4>
              <ul className="list-disc list-inside space-y-1 ml-2">
                {RATES.distanceRates.map((rate, index) => (
                  <li key={index}>
                    {rate.max === Infinity ?
                      `> ${rate.min.toFixed(2)} km: Base $${rate.basePrice} + $${rate.extraRate}/km extra` :
                      `${rate.min.toFixed(2)} - ${rate.max.toFixed(2)} km: $${rate.price} MXN`}
                  </li>
                ))}
              </ul>

              <h4 className="font-bold text-blue-400 mt-3">Tarifas Adicionales:</h4>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>**Ajuste GPS:** Se aplica un ajuste del **12.5%** a la distancia total (0.125 km por cada km) para compensar desvíos.</li>
                <li>**Rutas Fijas:** Rutas específicas (Walmart, Tecnológico, etc.) tienen tarifa fija que se usa como base para cálculos.</li>
                <li>**Rutas Especiales/Zonas:** +$5 MXN si la distancia es ≥ 3.7 km.</li>
                <li>**Mascota:** Con jaula: **+$20**; Sin jaula: **+$30**.</li>
                <li>**Servicio Especial:** Recoger: **+$60**; Comprar: **+$70**.</li>
                <li>**Pasajeros Adicionales:** Adultos **+$20**, Niños **+$10**.</li>
                <li>**Parada Rápida:** **+$20** MXN.</li>
                <li>**Parada con Servicio:** **+$50** MXN.</li>
              </ul>
            </div>
          )}
        </div>
        
        {/* Debug GPS (Se mantiene igual) */}
        <footer className="mt-6 text-center text-xs text-gray-500">
          {currentPosition && (
            <p>
              GPS: Lat {currentPosition.latitude.toFixed(6)}, Lon {currentPosition.longitude.toFixed(6)}
            </p>
          )}
          {tripData.isRunning && (
            <p>
              Distancia Cruda: {tripData.rawDistance.toFixed(3)} km
            </p>
          )}
        
        </footer>
      </div>
    </div>
  );
}

export default App;