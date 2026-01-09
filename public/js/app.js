// Wizard form handling
document.addEventListener('DOMContentLoaded', function() {
  const zipcodeInput = document.getElementById('zipcode');
  const countySelect = document.getElementById('county');
  const stateHidden = document.getElementById('state-hidden');
  const locationInfo = document.getElementById('location-info');
  const ageInput = document.getElementById('age');
  const incomeInput = document.getElementById('income');
  const householdHidden = document.getElementById('household-size');
  const householdDisplay = document.getElementById('household-display');
  const householdLabel = document.getElementById('household-label');
  const householdMinus = document.getElementById('household-minus');
  const householdPlus = document.getElementById('household-plus');

  // Steps
  const stepZip = document.getElementById('step-zip');
  const stepCounty = document.getElementById('step-county');
  const stepHousehold = document.getElementById('step-household');
  const stepAge = document.getElementById('step-age');

  // Navigation buttons
  const backToZip = document.getElementById('back-to-zip');
  const backToCounty = document.getElementById('back-to-county');
  const nextToAge = document.getElementById('next-to-age');
  const backBtn = document.getElementById('back-btn');

  let currentState = null;
  let currentCounty = null;
  let hasMultipleCounties = false;
  let isLookingUp = false;
  let lastLookedUpZip = null;

  function showStep(step) {
    [stepZip, stepCounty, stepHousehold, stepAge].forEach(s => {
      if (s) s.classList.remove('active');
    });
    if (step) step.classList.add('active');
  }

  // Household stepper control
  function updateHouseholdDisplay(value) {
    if (householdDisplay) householdDisplay.textContent = value;
    if (householdLabel) householdLabel.textContent = value === 1 ? 'person' : 'people';
    if (householdHidden) householdHidden.value = value;
    if (householdMinus) householdMinus.disabled = value <= 1;
    if (householdPlus) householdPlus.disabled = value >= 8;
  }

  if (householdMinus && householdPlus && householdHidden) {
    updateHouseholdDisplay(1); // Initialize

    householdMinus.addEventListener('click', function() {
      let value = parseInt(householdHidden.value, 10);
      if (value > 1) {
        updateHouseholdDisplay(value - 1);
      }
    });

    householdPlus.addEventListener('click', function() {
      let value = parseInt(householdHidden.value, 10);
      if (value < 8) {
        updateHouseholdDisplay(value + 1);
      }
    });
  }

  // Format income input with commas
  if (incomeInput) {
    incomeInput.addEventListener('input', function() {
      let value = this.value.replace(/[^\d]/g, '');
      if (value) {
        value = parseInt(value, 10).toLocaleString();
      }
      this.value = value;
    });
  }

  if (zipcodeInput) {
    let debounceTimer;

    zipcodeInput.addEventListener('input', function() {
      const zip = this.value.replace(/\D/g, '');
      this.value = zip;

      // Reset
      if (locationInfo) {
        locationInfo.style.display = 'none';
        locationInfo.innerHTML = '';
      }
      currentState = null;
      currentCounty = null;

      clearTimeout(debounceTimer);

      if (zip.length === 5 && zip !== lastLookedUpZip) {
        debounceTimer = setTimeout(() => lookupZipCode(zip), 300);
      }
    });

    // Handle Enter key - trigger lookup immediately if valid zip
    zipcodeInput.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const zip = this.value.replace(/\D/g, '');
      if (zip.length !== 5 || zip === lastLookedUpZip || isLookingUp) return;
      clearTimeout(debounceTimer);
      lookupZipCode(zip);
    });
  }

  async function lookupZipCode(zip) {
    if (isLookingUp) return;
    isLookingUp = true;
    lastLookedUpZip = zip;

    try {
      if (locationInfo) {
        locationInfo.style.display = 'block';
        locationInfo.innerHTML = '<span class="loading-text">Looking up...</span>';
      }

      const response = await fetch(`/api/zipcode/${zip}`);
      const data = await response.json();

      // Check if zip changed while we were fetching
      if (zipcodeInput.value !== zip) {
        isLookingUp = false;
        return;
      }

      if (response.status === 404 || data.error) {
        if (locationInfo) locationInfo.innerHTML = '<span class="error-text">Zip code not found</span>';
        isLookingUp = false;
        return;
      }

      if (data.message) {
        if (locationInfo) locationInfo.innerHTML = `<span class="error-text">${data.message}</span>`;
        isLookingUp = false;
        return;
      }

      currentState = data.state;
      if (stateHidden) stateHidden.value = data.state;

      if (data.counties.length === 0) {
        if (locationInfo) locationInfo.innerHTML = '<span class="error-text">No plans available in this area</span>';
        isLookingUp = false;
        return;
      }

      if (data.counties.length === 1) {
        // Single county - go to household step
        currentCounty = data.counties[0];
        hasMultipleCounties = false;
        if (countySelect) {
          countySelect.innerHTML = `<option value="${data.counties[0]}" selected>${data.counties[0]}</option>`;
        }
        if (locationInfo) locationInfo.innerHTML = `<span class="success-text">${data.city}, ${data.state}</span>`;

        // Brief delay then show household step
        setTimeout(() => {
          showStep(stepHousehold);
          if (incomeInput) incomeInput.focus();
          isLookingUp = false;
        }, 500);
      } else {
        // Multiple counties - show county step
        hasMultipleCounties = true;
        if (countySelect) {
          countySelect.innerHTML = '<option value="">Select your county</option>' +
            data.counties.map(c => `<option value="${c}">${c}</option>`).join('');
        }
        if (locationInfo) locationInfo.innerHTML = `<span class="success-text">${data.city}, ${data.state}</span>`;

        setTimeout(() => {
          showStep(stepCounty);
          if (countySelect) countySelect.focus();
          isLookingUp = false;
        }, 500);
      }
    } catch (err) {
      console.error('Error looking up zip code:', err);
      if (locationInfo) locationInfo.innerHTML = '<span class="error-text">Error looking up zip code</span>';
      isLookingUp = false;
    }
  }

  if (countySelect) {
    countySelect.addEventListener('change', function() {
      if (this.value) {
        currentCounty = this.value;
        showStep(stepHousehold);
        if (incomeInput) incomeInput.focus();
      }
    });
  }

  // Back button handlers
  if (backToZip) {
    backToZip.addEventListener('click', function() {
      lastLookedUpZip = null;
      showStep(stepZip);
      if (zipcodeInput) {
        zipcodeInput.focus();
        zipcodeInput.select();
      }
    });
  }

  if (backToCounty) {
    backToCounty.addEventListener('click', function() {
      if (hasMultipleCounties) {
        showStep(stepCounty);
        if (countySelect) countySelect.focus();
      } else {
        lastLookedUpZip = null;
        showStep(stepZip);
        if (zipcodeInput) {
          zipcodeInput.focus();
          zipcodeInput.select();
        }
      }
    });
  }

  if (nextToAge) {
    nextToAge.addEventListener('click', function() {
      showStep(stepAge);
      if (ageInput) {
        ageInput.focus();
        ageInput.select();
      }
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', function() {
      showStep(stepHousehold);
      if (incomeInput) incomeInput.focus();
    });
  }

  // Compare functionality (for plans page)
  const compareCheckboxes = document.querySelectorAll('.compare-check');
  const compareBar = document.getElementById('compare-bar');
  const compareCount = document.getElementById('compare-count');
  const compareBtn = document.getElementById('compare-btn');
  const selectedPlans = new Set();

  if (compareCheckboxes.length > 0) {
    compareCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', function() {
        if (this.checked) {
          if (selectedPlans.size >= 4) {
            this.checked = false;
            alert('You can compare up to 4 plans at a time.');
            return;
          }
          selectedPlans.add(this.value);
        } else {
          selectedPlans.delete(this.value);
        }
        updateCompareBar();
      });
    });
  }

  function updateCompareBar() {
    if (compareBar) {
      if (selectedPlans.size > 0) {
        compareBar.classList.add('visible');
        compareCount.textContent = selectedPlans.size;
        compareBtn.href = `/compare?ids=${Array.from(selectedPlans).join(',')}`;
      } else {
        compareBar.classList.remove('visible');
      }
    }
  }

  // Format and auto-submit income input on plans page (in top info bar)
  const infoBarIncomeInput = document.querySelector('.your-info-bar #income');
  if (infoBarIncomeInput) {
    let incomeDebounceTimer;
    let lastIncomeValue = infoBarIncomeInput.value;

    infoBarIncomeInput.addEventListener('input', function() {
      // Format with commas
      let value = this.value.replace(/[^\d]/g, '');
      if (value) {
        value = parseInt(value, 10).toLocaleString();
      }
      this.value = value;

      // Auto-submit after user stops typing (800ms delay)
      clearTimeout(incomeDebounceTimer);
      if (value !== lastIncomeValue) {
        incomeDebounceTimer = setTimeout(() => {
          lastIncomeValue = value;
          this.form.submit();
        }, 800);
      }
    });

    // Also submit on blur if value changed
    infoBarIncomeInput.addEventListener('blur', function() {
      clearTimeout(incomeDebounceTimer);
      if (this.value !== lastIncomeValue) {
        lastIncomeValue = this.value;
        this.form.submit();
      }
    });

    // Submit on Enter key
    infoBarIncomeInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        clearTimeout(incomeDebounceTimer);
        e.preventDefault();
        this.form.submit();
      }
    });
  }
});
