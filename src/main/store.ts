import Store from 'electron-store';

export const postsStore = new Store({
  name: 'flucto-posts',
  defaults: {
    posts: [],
    reviews: {}
  }
});
