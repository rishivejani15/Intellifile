
# Test Plan

1. **Upload**: Select `dummy_test/test_doc.txt`.
2. **Verify**: Check for message "I've loaded the document...".
3. **Ask**: "What are the key features of IntelliFile?"
   - **Expected**: A list mentioning Secure, Fast, Flexible, Smart.
   - **Citation**: Should reference [Source 1].
4. **Ask**: "Does it use the cloud?"
   - **Expected**: No, it runs locally.
5. **Ask**: "Who built this?" 
   - **Expected**: Not mentioned in the text (or hallucinated if model is bad, aim for "I couldn't find this...").
