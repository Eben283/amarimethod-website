import { createRoot } from 'react-dom/client';
import ParkingApp from './ParkingApp.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<ErrorBoundary><ParkingApp /></ErrorBoundary>);
