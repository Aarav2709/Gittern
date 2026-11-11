// github's language colours, for the common ones
const COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Rust: '#dea584', Go: '#00ADD8', Java: '#b07219',
  'C++': '#f34b7d', C: '#555555', 'C#': '#178600', Swift: '#F05138', Kotlin: '#A97BFF', Ruby: '#701516', PHP: '#4F5D95',
  Zig: '#ec915c', Shell: '#89e051', HTML: '#e34c26', CSS: '#663399', SCSS: '#c6538c', Vue: '#41b883', Svelte: '#ff3e00',
  Dart: '#00B4AB', Lua: '#000080', Scala: '#c22d40', Haskell: '#5e5086', Elixir: '#6e4a7e', Erlang: '#B83998',
  Clojure: '#db5855', OCaml: '#ef7a08', 'F#': '#b845fc', R: '#198CE7', Julia: '#a270ba', Perl: '#0298c3',
  'Objective-C': '#438eff', 'Jupyter Notebook': '#DA5B0B', Dockerfile: '#384d54', Makefile: '#427819', CMake: '#DA3434',
  Nix: '#7e7eff', PowerShell: '#012456', 'Vim Script': '#199f4b', 'Emacs Lisp': '#c065db', TeX: '#3D6117',
  Astro: '#ff5a03', MDX: '#fcb32c', Markdown: '#083fa1', Assembly: '#6E4C13', Solidity: '#AA6746', GLSL: '#5686a5',
  HCL: '#844FBA', Batchfile: '#C1F12E', Nim: '#ffc200', Crystal: '#000100', V: '#4f87c4', Gleam: '#ffaff3',
  Roff: '#ecdebe', Starlark: '#76d275', Just: '#384d54', Mustache: '#724b3b', Handlebars: '#f7931e', Less: '#1d365d',
  Stylus: '#ff6347', CoffeeScript: '#244776', Groovy: '#4298b8', Fortran: '#4d41b1', Pascal: '#E3F171', D: '#ba595e',
  Odin: '#60AFFE', Mojo: '#ff4c1f', WGSL: '#1a5e9a', GDScript: '#355570', Smarty: '#f0c040', PLpgSQL: '#336790',
};
export const langColor = (name?: string | null) => (name && COLORS[name]) || '#8b949e';
