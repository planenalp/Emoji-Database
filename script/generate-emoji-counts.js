const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { parse } = require('fast-html-parser');

const EMOJI_COUNTS_URL = 'https://unicode.org/emoji/charts/emoji-counts.html';
const EMOJI_DATA_URL = 'https://unicode.org/emoji/charts/full-emoji-list.html';

// 配置
const CONFIG = {
  timeout: 30000, // 30秒超时
  maxRetries: 3,  // 最大重试次数
  retryDelay: 2000 // 重试延迟（毫秒）
};

// 肤色修饰符
const SKIN_TONE_MODIFIERS = [
  '\u{1F3FB}', // light skin tone
  '\u{1F3FC}', // medium-light skin tone
  '\u{1F3FD}', // medium skin tone
  '\u{1F3FE}', // medium-dark skin tone
  '\u{1F3FF}'  // dark skin tone
];

async function fetchWithRetry(url, options = {}, retryCount = 0) {
  try {
    console.log(`Attempting to fetch ${url} (attempt ${retryCount + 1}/${CONFIG.maxRetries + 1})...`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.timeout);
    
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`Request timeout after ${CONFIG.timeout/1000} seconds`);
    } else {
      console.log(`Request failed: ${error.message}`);
    }
    
    if (retryCount < CONFIG.maxRetries) {
      console.log(`Retrying in ${CONFIG.retryDelay/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
      return fetchWithRetry(url, options, retryCount + 1);
    }
    throw error;
  }
}

async function downloadEmojiData() {
  console.log('Downloading emoji data...');
  const response = await fetchWithRetry(EMOJI_DATA_URL);
  const data = await response.text();
  console.log(`Downloaded ${data.length} bytes of emoji data`);
  fs.writeFileSync(path.join(__dirname, '..', 'emoji-data.html'), data);
  console.log('Emoji data saved successfully');
}

async function downloadEmojiCounts() {
  console.log('Downloading emoji counts data...');
  const response = await fetchWithRetry(EMOJI_COUNTS_URL);
  const data = await response.text();
  console.log(`Downloaded ${data.length} bytes of emoji counts data`);
  fs.writeFileSync(path.join(__dirname, '..', 'emoji-counts.html'), data);
  console.log('Emoji counts data saved successfully');
}

function parseEmojiData(html) {
  const emojiData = {};
  console.log('Starting to parse emoji data...');
  
  const parsedRoot = parse(html);
  const rows = parsedRoot.querySelectorAll('tr');
  console.log(`Found ${rows.length} potential emoji rows`);
  
  let processedCount = 0;
  for (const row of rows) {
    const codeCell = row.querySelector('.code');
    const nameCell = row.querySelector('.name');
    const groupCell = row.querySelector('.group');
    
    if (!codeCell || !nameCell || !groupCell) continue;
    
    const codePoints = codeCell.text.trim().split(' ').map(cp => parseInt(cp, 16));
    const emoji = String.fromCodePoint(...codePoints);
    const name = nameCell.text.trim();
    const group = groupCell.text.trim();
    
    // 检查是否支持肤色变体
    const hasSkinToneSupport = name.toLowerCase().includes('hand') || 
                             name.toLowerCase().includes('person') ||
                             name.toLowerCase().includes('people');
    
    // 检查是否支持双肤色
    const hasDualSkinToneSupport = name.toLowerCase().includes('handshake') || 
                                  name.toLowerCase().includes('people holding hands');
    
    emojiData[emoji] = {
      name,
      group,
      skin_tone_support: hasSkinToneSupport,
      dual_skin_tone_support: hasDualSkinToneSupport
    };
    
    processedCount++;
    if (processedCount % 100 === 0) {
      console.log(`Processed ${processedCount} emojis...`);
    }
    
    // 如果支持肤色变体，添加所有肤色变体
    if (hasSkinToneSupport) {
      SKIN_TONE_MODIFIERS.forEach(modifier => {
        const variant = emoji + modifier;
        emojiData[variant] = {
          name: `${name} (${getSkinToneName(modifier)})`,
          group,
          skin_tone_support: true,
          is_variant: true,
          base_emoji: emoji
        };
      });
      
      // 如果支持双肤色，添加所有双肤色组合
      if (hasDualSkinToneSupport) {
        SKIN_TONE_MODIFIERS.forEach(modifier1 => {
          SKIN_TONE_MODIFIERS.forEach(modifier2 => {
            const variant = emoji + modifier1 + modifier2;
            emojiData[variant] = {
              name: `${name} (${getSkinToneName(modifier1)} and ${getSkinToneName(modifier2)})`,
              group,
              skin_tone_support: true,
              dual_skin_tone_support: true,
              is_variant: true,
              base_emoji: emoji
            };
          });
        });
      }
    }
  }
  
  console.log(`Finished parsing. Total emojis processed: ${processedCount}`);
  console.log(`Total entries in emojiData: ${Object.keys(emojiData).length}`);
  
  return emojiData;
}

function getSkinToneName(modifier) {
  const skinToneNames = {
    '\u{1F3FB}': 'light skin tone',
    '\u{1F3FC}': 'medium-light skin tone',
    '\u{1F3FD}': 'medium skin tone',
    '\u{1F3FE}': 'medium-dark skin tone',
    '\u{1F3FF}': 'dark skin tone'
  };
  return skinToneNames[modifier] || 'unknown skin tone';
}

function parseEmojiCounts(html) {
  console.log('Starting to parse emoji counts...');
  const stats = {
    total_without_skin_tone_variations: 0,
    component: 0,
    dual_skin_tone_support: 0,
    groups: {}
  };

  const parsedRoot = parse(html);
  const allRows = parsedRoot.querySelectorAll('tr');
  const theadCells = allRows[0].childNodes;
  const totalCells = allRows[allRows.length - 1].childNodes;

  // 获取总计数
  stats.total_without_skin_tone_variations = Number(totalCells[totalCells.length - 1].text);

  // 获取各组别计数
  const groups = ['Smileys & Emotion', 'People & Body', 'Animals & Nature', 'Food & Drink', 
                 'Travel & Places', 'Activities', 'Objects', 'Symbols', 'Flags'];
  const componentKey = 'Component';

  for (let i = 0; i < theadCells.length; i++) {
    const column = theadCells[i].text;
    const count = Number(totalCells[i].text);
    if (groups.includes(column)) {
      stats.groups[column] = count;
    } else if (column === componentKey) {
      stats.component = count;
    }
  }

  // 计算肤色变体总数
  const skinToneMarker = '🏿';
  const counts = allRows
    .filter(row => row.childNodes[0].text.match(skinToneMarker))
    .map(row => Number(row.childNodes[row.childNodes.length - 1].text));
  const skinToneVariations = counts.reduce((a, b) => a + b, 0);

  // 更新总计数
  stats.total_without_skin_tone_variations = stats.total_without_skin_tone_variations - skinToneVariations - stats.component;

  // 手动设置双肤色支持数量
  stats.dual_skin_tone_support = 13;

  return stats;
}

function generateGroupData(emojiData) {
  const groups = {};
  
  // 按组别组织emoji
  for (const [emoji, data] of Object.entries(emojiData)) {
    if (!groups[data.group]) {
      groups[data.group] = {
        name: data.group,
        emojis: []
      };
    }
    
    if (!data.is_variant) {
      groups[data.group].emojis.push({
        emoji,
        name: data.name,
        skin_tone_support: data.skin_tone_support,
        dual_skin_tone_support: data.dual_skin_tone_support
      });
    }
  }
  
  return Object.values(groups);
}

async function testWithMockData() {
  console.log('Running tests with mock data...');
  
  // 模拟emoji数据HTML
  const mockEmojiDataHtml = `
    <tr class="r0">
      <td class="code">1F600</td>
      <td class="name">grinning face</td>
      <td class="group">Smileys & Emotion</td>
    </tr>
    <tr class="r1">
      <td class="code">1F91D</td>
      <td class="name">handshake</td>
      <td class="group">People & Body</td>
    </tr>
    <tr class="r2">
      <td class="code">1F44B</td>
      <td class="name">waving hand</td>
      <td class="group">People & Body</td>
    </tr>
  `;

  // 模拟计数数据HTML
  const mockCountsHtml = `
    <tr><td>Smileys & Emotion</td><td>100</td></tr>
    <tr><td>People & Body</td><td>200</td></tr>
    <tr><td>Total: 300</td></tr>
    <tr><td>Components: 10</td></tr>
    <tr><td>Dual skin tone support: 5</td></tr>
  `;

  // 测试解析
  const stats = parseEmojiCounts(mockCountsHtml);
  const emojiData = parseEmojiData(mockEmojiDataHtml);
  const groupData = generateGroupData(emojiData);

  // 验证结果
  console.log('\nTest Results:');
  console.log('Stats:', JSON.stringify(stats, null, 2));
  console.log('Emoji Data:', JSON.stringify(emojiData, null, 2));
  console.log('Group Data:', JSON.stringify(groupData, null, 2));

  // 验证关键数据
  const assertions = [
    stats.total_without_skin_tone_variations === 300,
    stats.component === 10,
    stats.dual_skin_tone_support === 5,
    Object.keys(emojiData).length > 0,
    groupData.length > 0
  ];

  const failedAssertions = assertions.filter(assertion => !assertion);
  if (failedAssertions.length > 0) {
    throw new Error('Some tests failed');
  }

  console.log('All tests passed!');
}

async function main() {
  try {
    // 如果是测试模式，使用模拟数据
    if (process.argv.includes('--test')) {
      await testWithMockData();
      return;
    }

    // 确保目录存在
    const rootDir = path.join(__dirname, '..');
    if (!fs.existsSync(rootDir)) {
      fs.mkdirSync(rootDir, { recursive: true });
    }

    // 确保test目录存在
    const testDir = path.join(rootDir, 'test');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // 下载emoji数据
    await downloadEmojiData();
    await downloadEmojiCounts();

    // 读取并解析HTML
    const countsHtml = fs.readFileSync(path.join(__dirname, '..', 'emoji-counts.html'), 'utf8');
    const dataHtml = fs.readFileSync(path.join(__dirname, '..', 'emoji-data.html'), 'utf8');
    
    const stats = parseEmojiCounts(countsHtml);
    const emojiData = parseEmojiData(dataHtml);
    const groupData = generateGroupData(emojiData);

    // 保存统计信息
    fs.writeFileSync(
      path.join(__dirname, '..', 'test', 'stats.json'),
      JSON.stringify(stats, null, 2)
    );

    // 保存emoji数据
    fs.writeFileSync(
      path.join(__dirname, '..', 'data-by-emoji.json'),
      JSON.stringify(emojiData, null, 2)
    );

    // 保存分组数据
    fs.writeFileSync(
      path.join(__dirname, '..', 'data-by-group.json'),
      JSON.stringify(groupData, null, 2)
    );

    // 生成有序emoji列表
    const orderedEmojis = Object.keys(emojiData).sort();
    fs.writeFileSync(
      path.join(__dirname, '..', 'data-ordered-emoji.json'),
      JSON.stringify(orderedEmojis, null, 2)
    );

    // 生成组件emoji数据
    const componentEmojis = Object.fromEntries(
      Object.entries(emojiData).filter(([_, data]) => data.group === 'Component')
    );
    fs.writeFileSync(
      path.join(__dirname, '..', 'data-emoji-components.json'),
      JSON.stringify(componentEmojis, null, 2)
    );

    console.log('🎉 Emoji data generated successfully!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件，则执行main函数
if (require.main === module) {
  main();
} 