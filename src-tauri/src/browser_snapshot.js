(function () {
  try {
    document.querySelectorAll('[data-supercharge-ref]').forEach(function (element) {
      element.removeAttribute('data-supercharge-ref');
    });
    var elements = [];
    document.querySelectorAll('a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[contenteditable="true"]').forEach(function (element) {
      if (elements.length >= 150 || element.getClientRects().length === 0) return;
      var style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') return;
      var ref = elements.length + 1;
      element.setAttribute('data-supercharge-ref', String(ref));
      elements.push({
        ref: ref,
        role: element.getAttribute('role') || element.tagName.toLowerCase(),
        label: (element.getAttribute('aria-label') || element.innerText || element.getAttribute('placeholder') || element.getAttribute('name') || '').slice(0, 180),
        type: element.getAttribute('type') || undefined,
        href: element.getAttribute('href') || undefined,
        disabled: !!element.disabled
      });
    });
    return {
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      text: (document.body ? document.body.innerText : '').slice(0, 16000),
      elements: elements
    };
  } catch (error) {
    return { error: String(error) };
  }
})()
