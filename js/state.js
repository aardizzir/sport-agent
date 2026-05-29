export const state = {
  currentUser: null,
  currentProfile: null,
  currentConversationId: null,
  messageHistory: [],
  isStreaming: false,
  availableDisciplines: [],
  onboardingData: {
    name: '',
    age: null,
    weight_kg: null,
    disciplines: [],
    experience: null,
    frequency_per_week: 4
  },
  onboardingStep: 0,
  currentTab: 'hoy'
};
