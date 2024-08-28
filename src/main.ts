import { config } from 'dotenv';
import {
  clearIndices,
  initialize as initializeConfig,
  shutdown,
  synchronizeIndices,
} from './service/synchronizer';

config();

const main = async () => {
  await initializeConfig();
  await clearIndices();
  await synchronizeIndices();
  await shutdown();
};

main();
