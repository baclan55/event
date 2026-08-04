window.Sections = window.Sections || {};
window.Sections.regulations = {
  render(container) {
    ContentSection.render(container, { section: 'regulations', hasToggle: true });
  },
};
