import { render } from 'preact';
import { App } from './app';
import './styles/app.css';

declare const CESIUM_BASE_URL: string;
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;

render(<App />, document.getElementById('app')!);
