<?php
declare(strict_types=1);

// Copy this file to config.php and fill in your Sakura/MySQL/OpenAI settings.

const APP_NAME = 'ACTION MAP 90';
const APP_ENV = 'production';

const DB_HOST = 'mysql0000.db.sakura.ne.jp';
const DB_NAME = 'your_database_name';
const DB_USER = 'your_database_user';
const DB_PASS = 'your_database_password';
const DB_CHARSET = 'utf8mb4';

const OPENAI_API_KEY = 'sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const OPENAI_MODEL = 'gpt-4.1-mini';
const OPENAI_IMAGE_MODEL = 'gpt-image-1';

// Optional. If empty, the app shows YouTube search links instead of API results.
const YOUTUBE_API_KEY = '';

// Change this to a long random string before publishing.
const SESSION_SECRET = 'change-this-to-a-long-random-string';
