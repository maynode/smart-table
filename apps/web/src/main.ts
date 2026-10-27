import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import { router } from './router';
import { bootstrapObjectOutbox } from './sync/object-outbox';
import './styles.css';

registerSW({ immediate: true });
bootstrapObjectOutbox();

createApp(App).use(router).mount('#app');