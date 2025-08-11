import axios from 'axios';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const TEST_URLS = [
  'https://example.com',
  'https://example.org'
];

async function testEndpoint() {
  try {
    console.log('Testing /URL_Text endpoint...');
    
    const response = await axios.post(`${BASE_URL}/URL_Text`, {
      sessionId: 'test-' + Date.now(),
      urls: TEST_URLS
    });
    
    console.log('Test successful! Response:');
    console.log({
      status: response.status,
      data: response.data
    });
    
    return true;
  } catch (error) {
    console.error('Test failed:');
    console.error({
      message: error.message,
      response: error.response?.data,
      stack: error.stack
    });
    return false;
  }
}

(async () => {
  const success = await testEndpoint();
  process.exit(success ? 0 : 1);
})();
