window.Sections = window.Sections || {};
window.Sections.faq = {
  render(container) {
    ContentSection.render(container, { section: 'faq', hasToggle: true });
  },
};
