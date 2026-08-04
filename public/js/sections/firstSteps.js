window.Sections = window.Sections || {};
window.Sections.firstSteps = {
  render(container) {
    ContentSection.render(container, { section: 'first_steps', hasToggle: false, heading: 'Первые шаги' });
  },
};
