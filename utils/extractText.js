import axios from 'axios';
import { load } from 'cheerio';
import logger from './logger.js';

export async function extractTextFromUrls(urls) {
  const texts = [];
  
  for (let i = 0; i < urls.length; i++) {
    try {
      logger.debug(`Fetching content from URL: ${urls[i]}`);
      const response = await axios.get(urls[i], {
        timeout: parseInt(process.env.URL_FETCH_TIMEOUT) || 10000,
        headers: {
          'User-Agent': process.env.USER_AGENT || 'Mozilla/5.0 (compatible; TTS-Chunker-Service/1.0)'
        }
      });
      
      const $ = load(response.data);
      
      // Remove unwanted elements
      $('script, style, noscript, iframe, nav, footer').remove();
      
      // Get text content and clean it up
      let text = $('body').text()
        .replace(/\s+/g, ' ')
        .trim();
      
      // Apply length limit if configured
      const maxLength = process.env.MAX_TEXT_LENGTH ? parseInt(process.env.MAX_TEXT_LENGTH) : null;
      if (maxLength && text.length > maxLength) {
        text = text.substring(0, maxLength) + '... [text truncated]';
        logger.warn(`Text content truncated for URL: ${urls[i]}`);
      }
        
      texts.push({ 
        url: urls[i], 
        text: text || '[No text content found]', 
        index: i,
        status: 'success'
      });
      
    } catch (error) {
      logger.error(`Error fetching URL ${urls[i]}: ${error.message}`);
      texts.push({ 
        url: urls[i], 
        text: `[Error fetching content: ${error.message}]`, 
        index: i,
        status: 'error',
        error: error.message
      });
    }
  }
  
  return texts;
        }
