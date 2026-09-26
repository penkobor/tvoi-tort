// Всё, что можно поменять под себя, — здесь.

export const CONFIG = {
  age: 29,

  title: 'С днём рождения!',
  letter: [
    'Желаю тебе исполнения всех целей и желаний.',
    'Пусть всё складывается прекрасно, а в жизни будет много тёплых и счастливых моментов.',
    'Я всегда буду рядом.',
  ],
  love: 'Я тебя люблю',

  music: {
    // Свой файл песни (mp3 или m4a) — тогда музыка включается с первого касания,
    // в том числе на iPhone. Без файла играет YouTube-плеер.
    files: ['./assets/song.mp3', './assets/song.m4a'],
    youtubeId: 'd_yksr9a3-I',
    // С какой секунды начинать песню (если в начале файла или ролика тишина или диалог).
    start: 0,
    title: 'Bryan Adams — You Can’t Take Me',
  },

  wishes: [
    { emoji: '💪', title: 'Сила', text: 'Сил на всё, что задумаешь', color: '#ffae5c' },
    { emoji: '🏆', title: 'Успех', text: 'Успеха во всех делах', color: '#ffd166' },
    { emoji: '🌿', title: 'Здоровье', text: 'Крепкого здоровья', color: '#7be3a4' },
    { emoji: '✨', title: 'Мечты', text: 'Пусть сбываются все желания', color: '#cfa8ff' },
    { emoji: '🎯', title: 'Цели', text: 'Пусть исполняются все цели', color: '#ff7b7b' },
    { emoji: '☀️', title: 'Счастье', text: 'Счастья каждый день', color: '#ffe27a' },
    { emoji: '❤️', title: 'Любовь', text: 'Много любви и тепла', color: '#ff6f9c' },
  ],

  // Гости с тортом: фото без фона (PNG с прозрачностью). fade — какая доля снизу фото растворяется.
  people: [
    { photo: './assets/people/1-cut.png', fade: 0.08, legs: '#d8a488', shoes: '#d9b98a' },
    { photo: './assets/people/2-cut.png', fade: 0.03, cloth: '#141416', legs: '#1b1b1b', shoes: '#0d0d0d' },
  ],
};
